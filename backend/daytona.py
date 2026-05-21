from __future__ import annotations

import logging
import os
import threading
import time
from pathlib import Path

from dotenv import load_dotenv

from deepagents.backends.protocol import (
    FILE_NOT_FOUND,
    FileDownloadResponse,
    FileUploadResponse,
)
from deepagents.backends.protocol import ExecuteResponse as DeepExecuteResponse
from deepagents.backends.sandbox import BaseSandbox

load_dotenv(Path(__file__).parent / ".env")

# Monkey-patch pra silenciar o flush loop do langgraph_runtime_inmem.
# Por padrão ele persiste estado in-memory pra disco a cada 10s, o que gera o
# "13 changes detected" do watchfiles. langgraph_api/cli.py:269 hard-codeia
# LANGGRAPH_DISABLE_FILE_PERSISTENCE=false em patch_environment e ignora
# explicitamente nosso .env (api/cli.py:276-282), então a única forma de
# desligar sem reescrever o launcher é monkey-patchear depois que o módulo
# já carregou. Daytona.py é importado por api.py durante app startup, que
# acontece DEPOIS do flush loop começar — mata retroativamente.
try:
    import langgraph_runtime_inmem._persistence as _persistence_mod  # type: ignore
    if not _persistence_mod.DISABLE_FILE_PERSISTENCE:
        _persistence_mod.DISABLE_FILE_PERSISTENCE = True
        _persistence_mod.stop_flush_loop()
        logging.getLogger(__name__).info(
            "langgraph_runtime_inmem flush loop desligado (monkey-patch). "
            "Tradeoff: threads/runs in-memory são perdidos ao reiniciar langgraph dev."
        )
except Exception as _exc:
    logging.getLogger(__name__).debug(
        "Não foi possível desligar flush loop do langgraph_runtime_inmem: %s", _exc,
    )

DAYTONA_API_KEY = os.environ.get("DAYTONA_API_KEY", "")
DAYTONA_SERVER_URL = os.environ.get("DAYTONA_SERVER_URL", "")
# Snapshot Daytona pré-publicado (ver Dockerfile.daytona.sandbox) que define a
# imagem base de todo sandbox criado por este backend. Obrigatório — ausência
# levanta ValueError no primeiro create(). Pré-instala gh/node/git/jq/ripgrep
# pra eliminar cold-start de `apt-get install` no agente.
DAYTONA_SNAPSHOT = os.environ.get("DAYTONA_SNAPSHOT", "").strip()
# Default upper bound for sandbox.process.exec — sem isso, uma chamada presa
# na API do Daytona trava o worker para sempre. Override via env.
DAYTONA_EXEC_TIMEOUT_SECS = int(os.environ.get("DAYTONA_EXEC_TIMEOUT_SECS", "30"))
# Path absoluto dentro do sandbox onde o repositório é clonado. Fonte única de
# verdade — usada no `git clone`, injetada no system prompt do agente via
# _factory._codebase_block, e devolvida pelo /sandboxes/{slug} pro frontend.
# Override via env (raramente necessário, default cobre a imagem padrão do Daytona).
DAYTONA_REPO_PATH = os.environ.get("DAYTONA_REPO_PATH", "/home/daytona/repo")
# Path absoluto dentro do sandbox onde artefatos (drafts e aprovados) vivem.
# Achatado por slug: {DAYTONA_SPECS_PATH}/{slug}/{PHASE}.md. Estado (draft vs
# aprovado) é metadado do blob — não reflete em subpasta no sandbox.
DAYTONA_SPECS_PATH = os.environ.get("DAYTONA_SPECS_PATH", "/home/daytona/specs")
# Minutos de ociosidade antes do Daytona parar o sandbox (estado `stopped`).
# 0 desabilita auto-stop. Default 5 é seguro pra testes locais — em produção
# subir pra 45 no .env para reduzir cold-starts.
DAYTONA_AUTO_STOP_INTERVAL_MIN = int(os.environ.get("DAYTONA_AUTO_STOP_INTERVAL_MIN", "5"))
# TTL do cache de estado do sandbox. Evita HTTP round-trip ao Daytona em /ensure
# repetidos dentro da janela (caso típico: idempotência B). Default 60s — muito
# menor que auto_stop (5+ min), então cache "running" é confiável dentro da TTL.
# Após o TTL, _refresh_state é chamado pra detectar estado C (stopped pelo Daytona).
DAYTONA_STATE_CACHE_TTL_SECS = float(os.environ.get("DAYTONA_STATE_CACHE_TTL_SECS", "60"))

# Estados em que o sandbox pode ser usado diretamente
_RUNNING_STATES = {"started", "starting", "restoring"}
# Estados em que vale tentar um restart
_RESTARTABLE_STATES = {"stopped"}
# Estados terminais — sandbox deve ser removido do manager
_DEAD_STATES = {"archived", "archiving", "destroyed", "destroying", "error", "build_failed"}

logger = logging.getLogger(__name__)


def _inject_pat(repo_url: str, pat: str) -> str:
    if pat and repo_url.startswith("https://"):
        return "https://" + pat + "@" + repo_url[len("https://"):]
    return repo_url


def _make_client():
    from daytona_sdk import Daytona, DaytonaConfig

    if not DAYTONA_API_KEY:
        raise RuntimeError("DAYTONA_API_KEY não configurado no .env")

    cfg = DaytonaConfig(api_key=DAYTONA_API_KEY)
    if DAYTONA_SERVER_URL:
        cfg.server_url = DAYTONA_SERVER_URL
    return Daytona(cfg)


def _refresh_state(sandbox) -> str | None:
    """Retorna sandbox.state após refresh; None se falhar."""
    try:
        sandbox.refresh_data()
        return sandbox.state
    except Exception as exc:
        logger.debug("refresh_data falhou: %s", exc)
        return None


def _safe_list(blob, slug: str, namespace: str) -> list[str]:
    """list_artifacts wrapped pra ThreadPoolExecutor — never raises."""
    try:
        return blob.list_artifacts(slug, namespace=namespace)
    except Exception as exc:
        logger.warning("hydrate: list_artifacts(%s) falhou: %s", namespace, exc)
        return []


def _safe_get(blob, slug: str, phase: str, namespace: str) -> str | None:
    """get_artifact wrapped pra ThreadPoolExecutor — never raises."""
    try:
        return blob.get_artifact(slug, phase, namespace=namespace)
    except Exception as exc:
        logger.warning("hydrate: get_artifact(%s, %s) falhou: %s", phase, namespace, exc)
        return None


class DaytonaBackend(BaseSandbox):
    """BaseSandbox backed by a Daytona workspace.

    Implementa execute() + upload_files() + download_files();
    ls/read/write/edit/grep/glob são derivados automaticamente pelo BaseSandbox.
    """

    def __init__(self, sandbox) -> None:
        self._sandbox = sandbox

    @property
    def id(self) -> str:
        return self._sandbox.id

    def execute(self, command: str, *, timeout: int | None = None) -> DeepExecuteResponse:
        effective_timeout = timeout if timeout is not None else DAYTONA_EXEC_TIMEOUT_SECS
        preview = command if len(command) <= 200 else command[:200] + "…"
        logger.debug("Daytona exec start (timeout=%ds): %s", effective_timeout, preview)
        try:
            result = self._sandbox.process.exec(command, timeout=effective_timeout)
        except Exception as exc:
            logger.warning("Daytona exec FAILED after timeout=%ds: %s — %s",
                           effective_timeout, type(exc).__name__, exc)
            # Output VAZIO em falha (não synthetic). O parser de grep do
            # deepagents (sandbox.py:763-781) faz `int(parts[1])` em cada linha
            # split por ':' — uma string tipo "[daytona exec error: DaytonaError: …]"
            # vira parts=["[daytona exec error", " DaytonaError", " …"] e crasha
            # com `invalid literal for int() with base 10: ' DaytonaError'`,
            # derrubando o run inteiro. Empty cai no fast-path `if not output`
            # (sandbox.py:766) que devolve GrepResult vazio sem parsing.
            # O contexto real do erro fica no log warning acima.
            return DeepExecuteResponse(output="", exit_code=124)
        logger.debug("Daytona exec done exit=%s (%d bytes)",
                     result.exit_code, len(result.result or ""))
        return DeepExecuteResponse(output=result.result or "", exit_code=result.exit_code)

    def upload_files(self, files: list[tuple[str, bytes]]) -> list[FileUploadResponse]:
        from daytona_sdk._sync.filesystem import FileUpload

        responses = []
        for path, content in files:
            try:
                self._sandbox.fs.upload_files([FileUpload(source=content, destination=path)])
                responses.append(FileUploadResponse(path=path))
            except Exception:
                responses.append(FileUploadResponse(path=path, error="permission_denied"))
        return responses

    def download_files(self, paths: list[str]) -> list[FileDownloadResponse]:
        responses = []
        for path in paths:
            try:
                content = self._sandbox.fs.download_file(path)
                if content is None:
                    responses.append(FileDownloadResponse(path=path, error=FILE_NOT_FOUND))
                else:
                    responses.append(FileDownloadResponse(path=path, content=content))
            except Exception:
                responses.append(FileDownloadResponse(path=path, error=FILE_NOT_FOUND))
        return responses


class _DaytonaManager:
    """Gerencia o ciclo de vida dos workspaces Daytona por slug."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        # slug -> (client, sandbox, repo_path | None)
        self._entries: dict[str, tuple[object, object, str | None]] = {}
        # Lock por slug pra serializar ensure_sandbox concorrente no mesmo slug.
        # Dois /ensure pro mesmo slug: o segundo bloqueia, depois pega estado B
        # e devolve o mesmo sandbox_id sem criar duplicado.
        self._slug_locks_master = threading.Lock()
        self._slug_locks: dict[str, threading.Lock] = {}
        # Cache do estado real do sandbox (slug -> (state, refreshed_at_epoch)).
        # Evita HTTP round-trip ao Daytona em /ensure repetidos. TTL configurável
        # via DAYTONA_STATE_CACHE_TTL_SECS. Invalidado em create/start/remove.
        self._state_cache: dict[str, tuple[str, float]] = {}
        # Cache de hidratação por slug. Evita re-listar e re-upload de artefatos
        # do blob a cada /ensure repetido. Invalidado por mutações no blob (PUT
        # /drafts, DELETE /drafts, /approve, /cancel). TTL alinhada ao state cache.
        # Conteúdo é um marcador opaco (timestamp + número de arquivos hidratados).
        self._hydrate_cache: dict[str, float] = {}

        from db import init_db
        init_db()
        try:
            self._reload_from_db()
        except Exception as exc:
            logger.warning("Não foi possível reconectar sandboxes do banco: %s", exc)

    def _get_slug_lock(self, slug: str) -> threading.Lock:
        with self._slug_locks_master:
            lock = self._slug_locks.get(slug)
            if lock is None:
                lock = threading.Lock()
                self._slug_locks[slug] = lock
            return lock

    def _reload_from_db(self) -> None:
        from db import get_active_sandboxes, update_sandbox_status

        rows = get_active_sandboxes()
        if not rows:
            return

        client = _make_client()
        for row in rows:
            try:
                sandbox = client.get(row["sandbox_id"])
                state = _refresh_state(sandbox)

                if state in _RUNNING_STATES:
                    with self._lock:
                        self._entries[row["slug"]] = (client, sandbox, row["repo_path"])

                elif state in _RESTARTABLE_STATES:
                    try:
                        client.start(sandbox)
                        with self._lock:
                            self._entries[row["slug"]] = (client, sandbox, row["repo_path"])
                        logger.info("Sandbox '%s' reiniciado após reload.", row["slug"])
                    except Exception as exc:
                        logger.warning("Falha ao reiniciar sandbox '%s': %s", row["slug"], exc)
                        update_sandbox_status(row["slug"], "deleted")

                else:
                    logger.warning(
                        "Sandbox '%s' no estado '%s', marcando como deletado.",
                        row["slug"], state,
                    )
                    update_sandbox_status(row["slug"], "deleted")

            except Exception as exc:
                logger.warning(
                    "Sandbox '%s' (id=%s) não encontrado no Daytona, marcando como deletado: %s",
                    row["slug"], row["sandbox_id"], exc,
                )
                update_sandbox_status(row["slug"], "deleted")

    def create(self, slug: str) -> tuple[DaytonaBackend, str | None]:
        """Cria sandbox Daytona pro slug. Lê metadata (repo_url/branch) de `projects`.

        Step 2 refactor: signature mono-arg. Caller (POST /api/projects ou
        ensure_sandbox em estado A/D) precisa ter feito upsert_project ANTES.

        Raises ValueError se `projects.slug` não existe.
        Returns (DaytonaBackend, repo_path | None).
        """
        from db import get_project, get_user_github_pat, upsert_sandbox

        project = get_project(slug)
        if project is None:
            raise ValueError(
                f"Projeto '{slug}' nao existe. POST /api/projects antes de criar sandbox."
            )

        owner = project["github_repo_owner"]
        repo = project["github_repo_name"]
        branch = project["github_default_branch"] or "main"
        repo_url: str | None = None
        if owner and repo:
            repo_url = f"https://github.com/{owner}/{repo}"

        if not DAYTONA_SNAPSHOT:
            raise ValueError(
                "DAYTONA_SNAPSHOT não configurado. Publique a imagem com "
                "`daytona snapshot create sdd-image:N --dockerfile Dockerfile.daytona.sandbox --context .` "
                "e adicione DAYTONA_SNAPSHOT=sdd-image:N ao backend/.env."
            )

        try:
            client = _make_client()
        except Exception as exc:
            logger.error("Falha ao inicializar cliente Daytona: %s", exc)
            raise RuntimeError(f"Não foi possível conectar ao Daytona: {exc}")

        from daytona_sdk import CreateSandboxFromSnapshotParams

        try:
            sandbox = client.create(CreateSandboxFromSnapshotParams(snapshot=DAYTONA_SNAPSHOT))
        except Exception as exc:
            logger.error("Falha ao criar sandbox: %s", exc)
            raise RuntimeError(f"Erro ao criar sandbox Daytona: {exc}")
        logger.info(
            "Daytona sandbox criado: id=%s slug=%s snapshot=%s",
            sandbox.id, slug, DAYTONA_SNAPSHOT,
        )

        # Ajusta auto-stop pra valor da env (default 5min em dev, 45min em prod).
        # Sandbox parado vira estado C, recuperável via client.start() em ensure_sandbox.
        try:
            sandbox.set_autostop_interval(DAYTONA_AUTO_STOP_INTERVAL_MIN)
        except Exception as exc:
            logger.warning("set_autostop_interval falhou (ignorado): %s", exc)

        repo_path: str | None = None
        if repo_url:
            # Usa constante hoisted em vez de `echo $HOME` — torna previsível
            # e overridável por env, e mantém a mesma string usada no prompt do
            # agente (_factory._codebase_block) e no payload da API pro front.
            repo_path = DAYTONA_REPO_PATH

            pat = get_user_github_pat() or ""
            effective_url = _inject_pat(repo_url, pat) if pat else repo_url

            logger.info("Iniciando git clone: slug=%s branch=%s path=%s", slug, branch, repo_path)
            clone_result = sandbox.process.exec(
                f"git clone --depth=1 --single-branch --branch {branch} {effective_url} {repo_path}",
                timeout=120,
            )
            if clone_result.exit_code != 0:
                raise RuntimeError(
                    f"git clone falhou (exit {clone_result.exit_code}): {clone_result.result}"
                )
            logger.info("git clone OK: slug=%s branch=%s path=%s", slug, branch, repo_path)

        with self._lock:
            self._entries[slug] = (client, sandbox, repo_path)
        # Sandbox acabou de ser criado e está running. Pré-popula o cache com
        # state="started" pra próximo /ensure dentro da TTL pular _refresh_state.
        self._state_cache[slug] = ("started", time.time())

        upsert_sandbox(slug, sandbox.id, repo_path)
        logger.info("Sandbox '%s' pronto para uso (entries=%d)", slug, len(self._entries))
        return DaytonaBackend(sandbox), repo_path

    def invalidate_hydration(self, slug: str) -> None:
        """Marca o cache de hidratação do slug como inválido.

        Chamar após mutações no blob storage (PUT/DELETE drafts, approve) pra
        garantir que o próximo /ensure re-sincroniza o sandbox a partir do blob.
        """
        self._hydrate_cache.pop(slug, None)

    def _hydrate_specs(self, slug: str, backend: "DaytonaBackend", force: bool = False) -> int:
        """Baixa do blob todos os artefatos do slug e escreve no sandbox em
        {DAYTONA_SPECS_PATH}/{slug}/{PHASE}.md (achatado).

        Source of truth = blob. Sandbox é mirror reconstruível. Cada /ensure
        re-hidrata pra garantir que edições do usuário (PUT /drafts) e approves
        cheguem ao agente na próxima geração.

        Retorna número de arquivos hidratados; 0 indica slug sem histórico.

        Cache: pular se hidratação recente (< DAYTONA_STATE_CACHE_TTL_SECS) e
        force=False. Mutações no blob (PUT drafts, approve, etc.) invalidam o
        cache via invalidate_hydration().
        """
        if not force:
            cached_at = self._hydrate_cache.get(slug)
            if cached_at is not None and (time.time() - cached_at) < DAYTONA_STATE_CACHE_TTL_SECS:
                return 0

        try:
            from storage.factory import create_blob_storage
        except Exception as exc:
            logger.warning("hydrate: blob storage indisponível: %s", exc)
            return 0

        from concurrent.futures import ThreadPoolExecutor

        t_start = time.time()
        blob = create_blob_storage()
        # features tem precedência sobre drafts no mesmo PHASE — approve garante
        # exclusão do draft então em prática nunca colidem, mas a ordem importa.

        # Step 1: parallel list_artifacts dos 2 namespaces (2 HTTP calls).
        namespaces = ("features", "drafts")
        with ThreadPoolExecutor(max_workers=2) as pool:
            list_results = list(
                pool.map(
                    lambda ns: (ns, _safe_list(blob, slug, ns)),
                    namespaces,
                )
            )

        # Step 2: dedupe phases (features ganha precedência).
        targets: list[tuple[str, str]] = []  # (namespace, phase) in priority order
        seen: set[str] = set()
        for ns, phases in list_results:
            for phase in phases:
                if phase in seen:
                    continue
                targets.append((ns, phase))
                seen.add(phase)

        # Step 3: parallel get_artifact (N HTTP calls). max_workers cap em 5 pra
        # não saturar a connection pool do blob storage (Azure tem limites).
        files: list[tuple[str, bytes]] = []
        if targets:
            with ThreadPoolExecutor(max_workers=min(5, len(targets))) as pool:
                contents = list(
                    pool.map(
                        lambda t: (t[1], _safe_get(blob, slug, t[1], t[0])),
                        targets,
                    )
                )
            for phase, content in contents:
                if not content:
                    continue
                path = f"{DAYTONA_SPECS_PATH}/{slug}/{phase}.md"
                files.append((path, content.encode("utf-8")))

        t_list = time.time() - t_start
        if t_list > 0.5:
            logger.debug("hydrate: list+get took %.2fs for slug=%s (%d files)", t_list, slug, len(files))

        if not files:
            # Slug sem artefatos no blob — marca como sincronizado pra evitar
            # re-listar a cada /ensure. Invalidação ocorre em PUT/approve.
            self._hydrate_cache[slug] = time.time()
            return 0

        # mkdir -p garante o diretório pai antes de uploads em batch. Sem isso,
        # primeira hidratação de um sandbox novo pode falhar com "no such file
        # or directory" dependendo da implementação do SDK Daytona.
        try:
            backend.execute(f"mkdir -p {DAYTONA_SPECS_PATH}/{slug}", timeout=10)
        except Exception as exc:
            logger.warning("hydrate: mkdir falhou (continuando): %s", exc)

        responses = backend.upload_files(files)
        failed = [r for r in responses if getattr(r, "error", None)]
        if failed:
            logger.warning(
                "hydrate: %d/%d uploads falharam para slug=%s",
                len(failed), len(files), slug,
            )
        else:
            logger.debug("hydrate: %d artefatos sincronizados para slug=%s", len(files), slug)
            # Só cacheia "sincronizado" quando o upload completo deu certo.
            # Falha parcial: próximo /ensure reprocessa.
            self._hydrate_cache[slug] = time.time()
        return len(files) - len(failed)

    def ensure_sandbox(self, slug: str) -> tuple[DaytonaBackend, str | None, str]:
        """State machine A/B/C/D — idempotente, sob lock por slug.

        - A) sem registro / status terminal → cria + (clone se brownfield) + upsert
        - B) registro ativo, sandbox RUNNING → no-op, devolve cache
        - C) registro ativo, sandbox STOPPED → client.start() + devolve
        - D) registro ativo, sandbox 404 ou DEAD → marca deleted, recria (cai em A)

        Step 2 refactor: signature mono-arg. Metadata (repo_url, branch) é lida
        de `projects` table dentro de `create()`. Caller precisa garantir que
        `projects.slug` exista — fora isso, levanta ValueError.

        Retorna (backend, repo_path, status) onde status ∈ {ready, started, created}.
        """
        from db import get_project, get_sandbox_record, update_sandbox_status

        # Pre-check: projects row precisa existir (POST /api/projects deve ter rodado).
        if get_project(slug) is None:
            raise ValueError(
                f"Projeto '{slug}' nao existe. POST /api/projects antes."
            )

        lock = self._get_slug_lock(slug)
        with lock:
            record = get_sandbox_record(slug)
            terminal = {"deleted", "cancelled", "completed"}

            def _finalize(backend: DaytonaBackend, repo_path: str | None, status: str):
                # Hidratação sempre roda no caminho de retorno — mantém sandbox
                # como mirror atualizado do blob (drafts+features) antes do
                # próximo run do agente. Falhas são logadas no _hydrate_specs.
                t_hyd = time.time()
                try:
                    self._hydrate_specs(slug, backend)
                except Exception as exc:
                    logger.warning("[ensure %s] _hydrate_specs falhou: %s", slug, exc)
                dt = time.time() - t_hyd
                if dt > 0.3:
                    logger.info("[ensure %s] hydrate total %.2fs", slug, dt)
                return backend, repo_path, status

            # Estado A
            if record is None or record["status"] in terminal:
                logger.info("[ensure %s] estado A — create", slug)
                backend, repo_path = self.create(slug)
                return _finalize(backend, repo_path, "created")

            # Status active — checa estado real no Daytona
            sandbox_id = record["sandbox_id"]
            with self._lock:
                entry = self._entries.get(slug)

            try:
                if entry is not None:
                    client, sandbox, repo_path_cached = entry
                else:
                    client = _make_client()
                    sandbox = client.get(sandbox_id)
                    repo_path_cached = record["repo_path"]

                # Estado cacheado se entry está em cache E TTL ainda válido.
                # auto_stop_interval >> TTL, então "running" cacheado é confiável.
                # Cache miss/expirado → fresh refresh via Daytona API.
                cached = self._state_cache.get(slug) if entry is not None else None
                if cached and (time.time() - cached[1]) < DAYTONA_STATE_CACHE_TTL_SECS:
                    state = cached[0]
                else:
                    state = _refresh_state(sandbox)
                    if state is not None:
                        self._state_cache[slug] = (state, time.time())
            except Exception as exc:
                # Estado D — sandbox sumiu do Daytona ou erro de comunicação
                logger.info("[ensure %s] estado D (get falhou: %s) — recriar", slug, exc)
                update_sandbox_status(slug, "deleted")
                with self._lock:
                    self._entries.pop(slug, None)
                self._state_cache.pop(slug, None)
                backend, repo_path = self.create(slug)
                return _finalize(backend, repo_path, "created")

            # Estado B
            if state in _RUNNING_STATES:
                logger.debug("[ensure %s] estado B — running", slug)
                with self._lock:
                    self._entries[slug] = (client, sandbox, repo_path_cached)
                return _finalize(DaytonaBackend(sandbox), repo_path_cached, "ready")

            # Estado C — restartable
            if state in _RESTARTABLE_STATES:
                logger.info("[ensure %s] estado C — start", slug)
                try:
                    client.start(sandbox)
                    with self._lock:
                        self._entries[slug] = (client, sandbox, repo_path_cached)
                    self._state_cache[slug] = ("started", time.time())
                    return _finalize(DaytonaBackend(sandbox), repo_path_cached, "started")
                except Exception as exc:
                    logger.warning("[ensure %s] start falhou (%s) — recriar", slug, exc)
                    update_sandbox_status(slug, "deleted")
                    with self._lock:
                        self._entries.pop(slug, None)
                    self._state_cache.pop(slug, None)
                    backend, repo_path = self.create(slug)
                    return _finalize(backend, repo_path, "created")

            # Estado D — DEAD ou estado desconhecido
            logger.info("[ensure %s] estado D (state=%s) — recriar", slug, state)
            update_sandbox_status(slug, "deleted")
            with self._lock:
                self._entries.pop(slug, None)
            self._state_cache.pop(slug, None)
            backend, repo_path = self.create(slug)
            return _finalize(backend, repo_path, "created")

    def get(self, slug: str) -> tuple[DaytonaBackend, str | None] | tuple[None, None]:
        with self._lock:
            entry = self._entries.get(slug)
        if entry is None:
            return None, None
        client, sandbox, repo_path = entry
        return DaytonaBackend(sandbox), repo_path

    def get_state(self, slug: str) -> str | None:
        """Verifica o estado atual do sandbox no Daytona (chamada à API)."""
        with self._lock:
            entry = self._entries.get(slug)
        if entry is None:
            return None
        _, sandbox, _ = entry
        return _refresh_state(sandbox)

    def wake(self, slug: str) -> None:
        """Reinicia um sandbox parado."""
        with self._lock:
            entry = self._entries.get(slug)
        if entry is None:
            return
        client, sandbox, _ = entry
        client.start(sandbox)

    def remove(self, slug: str) -> bool:
        from db import update_sandbox_status

        with self._lock:
            entry = self._entries.pop(slug, None)
        self._state_cache.pop(slug, None)
        self._hydrate_cache.pop(slug, None)
        if entry is None:
            return False
        client, sandbox, _ = entry
        try:
            client.delete(sandbox)
        except Exception:
            pass
        update_sandbox_status(slug, "deleted")
        return True

    def complete(self, slug: str) -> None:
        """Encerra sandbox ao completar o pipeline (auto-delete no lifecycle)."""
        from db import update_sandbox_status

        with self._lock:
            entry = self._entries.pop(slug, None)
        self._state_cache.pop(slug, None)
        self._hydrate_cache.pop(slug, None)
        if entry is None:
            return
        client, sandbox, _ = entry
        try:
            client.delete(sandbox)
        except Exception:
            pass
        update_sandbox_status(slug, "completed")

    def exec_repo_find(self, slug: str, max_entries: int = 5000) -> str | None:
        """Lista arquivos do repositório clonado (snapshot para o ZIP).

        Retorna o stdout do `find` ou None se o sandbox/repo não estiver disponível.
        Ignora .git/ e limita o número de linhas para evitar payload absurdo.
        """
        with self._lock:
            entry = self._entries.get(slug)
        if entry is None:
            return None
        _, sandbox, repo_path = entry
        if not repo_path:
            return None
        try:
            cmd = (
                f"find {repo_path} -type f -not -path '*/.git/*' "
                f"| sort | head -n {max_entries}"
            )
            result = sandbox.process.exec(cmd, timeout=30)
            if result.exit_code != 0:
                return None
            return result.result or ""
        except Exception as exc:
            logger.warning("exec_repo_find falhou para slug '%s': %s", slug, exc)
            return None


manager = _DaytonaManager()
