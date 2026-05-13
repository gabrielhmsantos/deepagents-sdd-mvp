from __future__ import annotations

import logging
import os
import threading
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

DAYTONA_API_KEY = os.environ.get("DAYTONA_API_KEY", "")
DAYTONA_SERVER_URL = os.environ.get("DAYTONA_SERVER_URL", "")
# Default upper bound for sandbox.process.exec — sem isso, uma chamada presa
# na API do Daytona trava o worker para sempre. Override via env.
DAYTONA_EXEC_TIMEOUT_SECS = int(os.environ.get("DAYTONA_EXEC_TIMEOUT_SECS", "60"))

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
        logger.info("Daytona exec start (timeout=%ds): %s", effective_timeout, preview)
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
        logger.info("Daytona exec done exit=%s (%d bytes)",
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

        from db import init_db
        init_db()
        try:
            self._reload_from_db()
        except Exception as exc:
            logger.warning("Não foi possível reconectar sandboxes do banco: %s", exc)

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

    def create(
        self,
        slug: str,
        repo_url: str | None = None,
        branch: str = "main",
    ) -> tuple[DaytonaBackend, str | None]:
        from db import get_setting, upsert_sandbox

        try:
            client = _make_client()
        except Exception as exc:
            logger.error("Falha ao inicializar cliente Daytona: %s", exc)
            raise RuntimeError(f"Não foi possível conectar ao Daytona: {exc}")

        try:
            sandbox = client.create()
        except Exception as exc:
            logger.error("Falha ao criar sandbox: %s", exc)
            raise RuntimeError(f"Erro ao criar sandbox Daytona: {exc}")
        logger.info("Daytona sandbox criado: id=%s slug=%s", sandbox.id, slug)

        # Desabilita auto-stop para evitar cold start durante a sessão
        try:
            sandbox.set_autostop_interval(0)
        except Exception as exc:
            logger.warning("set_autostop_interval falhou (ignorado): %s", exc)

        repo_path: str | None = None
        if repo_url:
            home_result = sandbox.process.exec("echo $HOME")
            home = home_result.result.strip() if home_result.exit_code == 0 else "/tmp"
            repo_path = f"{home}/repo"

            pat = get_setting("github_pat") or ""
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

        upsert_sandbox(slug, sandbox.id, repo_path)
        logger.info("Sandbox '%s' pronto para uso (entries=%d)", slug, len(self._entries))
        return DaytonaBackend(sandbox), repo_path

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
