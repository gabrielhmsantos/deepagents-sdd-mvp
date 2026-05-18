import asyncio
import hashlib
import io
import json
import logging
import uuid
import os
import socket
import threading
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel

from daytona import manager as daytona_manager
from db import init_db
from sandboxes import router as sandboxes_router
from settings_routes import router as settings_router
from storage.factory import create_blob_storage
from uploads import router as uploads_router

logger = logging.getLogger(__name__)

PHASES = {"CONSTITUICAO", "PRD", "ESPECIFICACAO", "PLANO", "TAREFAS"}
PHASE_ORDER = ["CONSTITUICAO", "PRD", "ESPECIFICACAO", "PLANO", "TAREFAS"]
REPO_TREE_KEY = "REPO_TREE"  # entrada interna no blob storage (não é uma phase)
DRAFTS_NS = "drafts"
FEATURES_NS = "features"

app = FastAPI(title="Champion AI — SDD Artifacts API")
init_db()
blob_storage = create_blob_storage()


# ── IPv6 → IPv4 loopback forwarder ────────────────────────────────────────────
# langgraph dev binda uvicorn em 0.0.0.0/127.0.0.1 (IPv4-only). No Windows,
# getaddrinfo('localhost') retorna ::1 ANTES de 127.0.0.1, e o kernel demora
# ~2s pra rejeitar o connect IPv6 (não usa RST imediato como Linux). Resultado:
# clientes Python (urllib, requests) levam ~2s a mais por chamada antes de
# falhar pro IPv4. Estouva a verificação E2E de idempotência (< 2s).
#
# Fix: thread paralela que escuta em [::1]:PORT e faz forwarding raw para
# 127.0.0.1:PORT. No-op em outras plataformas (Linux já trata loopback dual-stack
# naturalmente, fica idempotente). Idempotente: se já houver listener em ::1,
# o bind falha e seguimos silenciosamente.
_FORWARDER_PORT = int(os.environ.get("LANGGRAPH_HTTP_PORT", "8000"))
_FORWARDER_STARTED = False
_FORWARDER_LOCK = threading.Lock()


def _forward_pipe(src: socket.socket, dst: socket.socket) -> None:
    try:
        while True:
            data = src.recv(65536)
            if not data:
                break
            dst.sendall(data)
    except OSError:
        pass
    finally:
        try:
            dst.shutdown(socket.SHUT_WR)
        except OSError:
            pass


def _handle_forwarder_client(client_sock: socket.socket) -> None:
    upstream = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        upstream.connect(("127.0.0.1", _FORWARDER_PORT))
    except OSError as exc:
        logger.debug("forwarder: upstream connect failed: %s", exc)
        client_sock.close()
        upstream.close()
        return
    t1 = threading.Thread(target=_forward_pipe, args=(client_sock, upstream), daemon=True)
    t2 = threading.Thread(target=_forward_pipe, args=(upstream, client_sock), daemon=True)
    t1.start(); t2.start()
    t1.join(); t2.join()
    client_sock.close()
    upstream.close()


def _run_ipv6_forwarder() -> None:
    try:
        srv = socket.socket(socket.AF_INET6, socket.SOCK_STREAM)
        srv.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
        srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        srv.bind(("::1", _FORWARDER_PORT))
        srv.listen(64)
        logger.info("IPv6 forwarder ativo: [::1]:%d → 127.0.0.1:%d", _FORWARDER_PORT, _FORWARDER_PORT)
    except OSError as exc:
        # Outro listener já está em ::1:PORT (reload do langgraph dev p.ex.) —
        # silencioso, não é erro. Ou plataforma sem IPv6, idem.
        logger.debug("IPv6 forwarder não iniciou (%s)", exc)
        return
    try:
        while True:
            try:
                client_sock, _ = srv.accept()
            except OSError:
                break
            threading.Thread(
                target=_handle_forwarder_client,
                args=(client_sock,),
                daemon=True,
            ).start()
    finally:
        try:
            srv.close()
        except OSError:
            pass


def _ensure_ipv6_forwarder() -> None:
    global _FORWARDER_STARTED
    with _FORWARDER_LOCK:
        if _FORWARDER_STARTED:
            return
        _FORWARDER_STARTED = True
        threading.Thread(target=_run_ipv6_forwarder, daemon=True).start()


# Inicia imediatamente no import — langgraph dev carrega api.py uma vez por
# processo; o thread é daemon então não bloqueia shutdown.
_ensure_ipv6_forwarder()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:4173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.exception("Erro não tratado: %s", exc)
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc)}
    )

app.include_router(uploads_router)
app.include_router(sandboxes_router)
app.include_router(settings_router)


class Artifact(BaseModel):
    content: str


class ProjectCreate(BaseModel):
    slug: str | None = None
    ssg_id: str | None = None
    github_repo_owner: str | None = None
    github_repo_name: str | None = None
    github_default_branch: str | None = None
    idea: str | None = None


# ── Project lifecycle (criação canonical + preflight + cancel) ──────────────

import re as _re
_SSG_RE = _re.compile(r"^\d{1,5}$")


@app.post("/projects")
def create_project(body: ProjectCreate):
    """Entry point canonical do form unificado de criação de projeto.

    Orquestra: validação → upsert em `projects` → criação eager da sandbox via
    `ensure_sandbox(slug)`. Step 2 substitui o uso anterior de POST /ensure
    com body — o body agora vive aqui.
    """
    from db import upsert_project, get_project

    # Slug auto-gerado: 8 chars hex (uuid4). Loop defensivo contra colisão
    # (improvável com 4 bilhões de combinações, mas UNIQUE constraint protege).
    if body.slug and body.slug.strip():
        slug = body.slug.strip().lower()
    else:
        for _ in range(5):
            slug = uuid.uuid4().hex[:8]
            if not get_project(slug):
                break
        else:
            raise HTTPException(500, "Falha ao gerar slug único após 5 tentativas")

    # Validação SSG_ID: 1-5 dígitos (paridade visual Champion).
    if body.ssg_id is not None and body.ssg_id.strip():
        if not _SSG_RE.match(body.ssg_id.strip()):
            raise HTTPException(400, "ssg_id deve ser 1-5 dígitos numéricos")
        ssg_id = body.ssg_id.strip()
    else:
        ssg_id = None

    # Brownfield consistency: owner + name vem juntos.
    owner = (body.github_repo_owner or "").strip() or None
    repo = (body.github_repo_name or "").strip() or None
    if (owner and not repo) or (repo and not owner):
        raise HTTPException(400, "github_repo_owner e github_repo_name vem juntos (ou ambos null pra greenfield)")
    mode = "brownfield" if (owner and repo) else "greenfield"

    branch = (body.github_default_branch or "").strip() or "main"
    idea = (body.idea or "").strip() or None

    upsert_project(
        slug=slug,
        ssg_id=ssg_id,
        github_repo_owner=owner,
        github_repo_name=repo,
        github_default_branch=branch,
        idea=idea,
    )

    try:
        backend, repo_path, status = daytona_manager.ensure_sandbox(slug)
    except ValueError as e:
        # Não deveria acontecer — acabamos de upsert. Defensivo.
        raise HTTPException(500, f"projects upsert OK mas ensure_sandbox levantou: {e}")
    except RuntimeError as e:
        # Clone falhou, Daytona indisponível, etc.
        raise HTTPException(422, str(e))
    except Exception as e:
        logger.exception("ensure_sandbox falhou na criação de '%s': %s", slug, e)
        raise HTTPException(500, f"Erro ao criar sandbox: {e}")

    return {
        "ok": True,
        "slug": slug,
        "sandbox_id": backend.id,
        "repo_path": repo_path,
        "mode": mode,
        "status": status,
    }


@app.get("/projects")
def list_projects_route():
    """Lista todos os projetos. Alimenta o sidebar do front."""
    from db import list_projects as _list
    rows = _list()
    # Import aqui pra evitar circular no módulo.
    from db import list_project_files as _list_files

    return {
        "projects": [
            {
                "slug": r["slug"],
                "ssg_id": r["ssg_id"],
                "idea": r["idea"],
                "github_repo_owner": r["github_repo_owner"],
                "github_repo_name": r["github_repo_name"],
                "github_default_branch": r["github_default_branch"],
                "created_at": r["created_at"],
            }
            for r in rows
        ]
    }


@app.delete("/projects/{slug}")
def delete_project_route(slug: str):
    """Wipe completo do projeto: sandbox no Daytona + blob (drafts+features+REPO_TREE)
    + DB rows. Best-effort, response inclui flags pra debugging.
    """
    from db import delete_project as _delete

    # 1. Cancela sandbox no Daytona (idempotente — best-effort)
    try:
        sandbox_canceled = daytona_manager.remove(slug)
    except Exception as exc:
        logger.warning("delete_project: sandbox cancel falhou pra '%s': %s", slug, exc)
        sandbox_canceled = False

    # 2. Wipe blob: drafts/, features/, e REPO_TREE_KEY de features/
    blob_deleted = 0
    for namespace in (DRAFTS_NS, FEATURES_NS):
        for phase in PHASES:
            try:
                if blob_storage.get_artifact(slug, phase, namespace=namespace) is not None:
                    blob_storage.delete_artifact(slug, phase, namespace=namespace)
                    blob_deleted += 1
            except Exception as exc:
                logger.warning("delete_project: blob %s/%s/%s falhou: %s", namespace, slug, phase, exc)
    try:
        if blob_storage.get_artifact(slug, REPO_TREE_KEY, namespace=FEATURES_NS) is not None:
            blob_storage.delete_artifact(slug, REPO_TREE_KEY, namespace=FEATURES_NS)
            blob_deleted += 1
    except Exception:
        pass

    # 3. Apaga row em projects (CASCADE limpa github_project_config)
    try:
        project_row_deleted = _delete(slug)
    except Exception as exc:
        logger.warning("delete_project: DB delete falhou pra '%s': %s", slug, exc)
        project_row_deleted = False

    # Wipe uploads do filesystem
    from uploads import UPLOADS
    uploads_dir = UPLOADS / slug
    if uploads_dir.exists():
        import shutil
        shutil.rmtree(uploads_dir, ignore_errors=True)

    return {
        "ok": True,
        "wiped": {
            "sandbox_canceled": sandbox_canceled,
            "blob_artifacts_deleted": blob_deleted,
            "project_row_deleted": project_row_deleted,
        },
    }


@app.get("/admin/projects")
def admin_list_projects():
    """View enriquecida pro admin panel: project + sandbox state + count de fases."""
    from db import list_projects as _list, get_sandbox_record
    rows = _list()
    out = []
    for r in rows:
        slug = r["slug"]
        sb = get_sandbox_record(slug)
        approved = blob_storage.list_artifacts(slug, namespace=FEATURES_NS) or []
        approved_phases = [p for p in approved if p in PHASES]
        idea = r["idea"] or ""
        out.append({
            "slug": slug,
            "ssg_id": r["ssg_id"],
            "idea": idea or None,  # full text — consumido pelo PhaseSection (initialInput)
            "idea_snippet": (idea[:60] + ("…" if len(idea) > 60 else "")) if idea else None,
            "github_repo_owner": r["github_repo_owner"],
            "github_repo_name": r["github_repo_name"],
            "github_default_branch": r["github_default_branch"],
            "sandbox_status": sb["status"] if sb else None,
            "sandbox_id": sb["sandbox_id"] if sb else None,
            "approved_phases": approved_phases,
            "approved_count": len(approved_phases),
            "total_phases": len(PHASES),
            "created_at": r["created_at"],
        })
    return {"projects": out}


# ── Per-project files (metadata from SQLite) ───────────────────────────────

@app.get("/projects/{slug}/files")
def list_project_files_route(slug: str):
    """Retorna metadados dos arquivos enviados para o projeto."""
    from db import list_project_files
    rows = list_project_files(slug)
    return {
        "files": [
            {
                "filename": r["filename"],
                "approx_tokens": r["approx_tokens"],
                "created_at": r["created_at"],
            }
            for r in rows
        ]
    }


# ── Sandbox lifecycle (preflight + cancel) ──────────────────────────────────

@app.post("/ensure/{slug}")
async def ensure_sandbox_route(slug: str, request: Request):
    """Preflight do sandbox: garante estado vivo antes do stream do agente.

    Step 2: REJEITA body. Pra criar projeto, use POST /projects.
    Pra slug sem projects row, retorna 400.
    """
    # Hard-break: nenhum body aceito. Detecta tentativa de envio.
    raw = await request.body()
    if raw and raw.strip() and raw.strip() != b"{}":
        raise HTTPException(
            400,
            "POST /ensure/{slug} não aceita mais body. Use POST /projects pra criar projeto."
        )

    try:
        # ensure_sandbox faz I/O blocking (sqlite + Daytona HTTP). Como esta rota é
        # `async def` (precisa de `await request.body()`), o LangGraph dev detecta
        # blocking calls no event loop. Wrap em to_thread move pra worker thread.
        backend, repo_path, status = await asyncio.to_thread(
            daytona_manager.ensure_sandbox, slug
        )
    except ValueError as e:
        # Projeto não existe — usuário precisa criar via /projects primeiro.
        raise HTTPException(400, str(e))
    except RuntimeError as e:
        raise HTTPException(422, str(e))
    except Exception as e:
        logger.exception("ensure_sandbox falhou para slug '%s': %s", slug, e)
        raise HTTPException(500, f"Erro ao garantir sandbox: {e}")

    return {
        "ok": True,
        "sandbox_id": backend.id,
        "repo_path": repo_path,
        "status": status,
    }


@app.post("/cancel/{slug}")
def cancel_sandbox(slug: str):
    """Cancela explicitamente o sandbox do slug. Deleta no Daytona e marca DB."""
    from db import update_sandbox_status

    removed = daytona_manager.remove(slug)
    # remove() já marca 'deleted' — sobrescreve para 'cancelled' pra distinguir
    # auditoria (delete externo vs cancelamento explícito do usuário).
    update_sandbox_status(slug, "cancelled")
    return {"ok": True, "removed": removed}


# ── GitHub integration (Step 2 + Step 4 cache) ──────────────────────────────

# Cache em memória dos repos do GitHub. TTL evita hit na API a cada abertura do
# RepoPicker. Invalidação só por expiração — user com novo repo aguarda TTL.
import time as _time

_GH_REPOS_CACHE_TTL_SECS = int(os.environ.get("GITHUB_REPOS_CACHE_TTL_SECS", "300"))
_GH_REPOS_CACHE: tuple[list[dict], float] | None = None


@app.get("/github/repos")
def list_github_repos():
    """Proxy autenticado à GitHub API. Lista repos acessíveis com o PAT global.

    Cache em memória (TTL via GITHUB_REPOS_CACHE_TTL_SECS, default 300s) reduz
    HTTP roundtrips ao GitHub em form opens frequentes.
    """
    from db import get_user_github_pat
    import httpx

    global _GH_REPOS_CACHE
    if _GH_REPOS_CACHE is not None:
        cached, ts = _GH_REPOS_CACHE
        if (_time.time() - ts) < _GH_REPOS_CACHE_TTL_SECS:
            return {"repos": cached}

    pat = get_user_github_pat()
    if not pat:
        raise HTTPException(400, "GitHub PAT nao configurado. PUT /settings/github-pat primeiro.")

    try:
        resp = httpx.get(
            "https://api.github.com/user/repos",
            headers={
                "Authorization": f"token {pat}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            },
            params={"per_page": 100, "sort": "updated"},
            timeout=10.0,
        )
    except Exception as e:
        raise HTTPException(502, f"GitHub API call falhou: {e}")

    if resp.status_code == 401:
        raise HTTPException(400, "PAT inválido ou sem permissão (401).")
    if resp.status_code != 200:
        raise HTTPException(502, f"GitHub API retornou {resp.status_code}: {resp.text[:200]}")

    data = resp.json()
    repos = [
        {
            "owner": r["owner"]["login"],
            "name": r["name"],
            "default_branch": r.get("default_branch") or "main",
            "private": r.get("private", False),
            "description": r.get("description"),
        }
        for r in data
    ]
    _GH_REPOS_CACHE = (repos, _time.time())
    return {"repos": repos}


def _check_phase(phase: str) -> None:
    if phase not in PHASES:
        raise HTTPException(400, f"phase inválido: deve ser um de {sorted(PHASES)}")


# ── Drafts (BlobStorage namespace=drafts) ─────────────────────────────────────

@app.put("/drafts/{slug}/{phase}")
def write_draft(slug: str, phase: str, body: Artifact):
    _check_phase(phase)
    blob_storage.save_artifact(slug, phase, body.content, namespace=DRAFTS_NS)
    # Invalida o cache de hidratação: o próximo /ensure deve sincronizar este
    # novo draft do blob → sandbox antes do próximo run do agente.
    daytona_manager.invalidate_hydration(slug)
    return {"ok": True}


@app.get("/drafts/{slug}/{phase}")
def read_draft(slug: str, phase: str):
    _check_phase(phase)
    content = blob_storage.get_artifact(slug, phase, namespace=DRAFTS_NS)
    if content is None:
        return {"exists": False, "content": None}
    return {"exists": True, "content": content}


@app.delete("/drafts/{slug}/{phase}")
def delete_draft(slug: str, phase: str):
    _check_phase(phase)
    blob_storage.delete_artifact(slug, phase, namespace=DRAFTS_NS)
    daytona_manager.invalidate_hydration(slug)
    return {"ok": True}


@app.get("/drafts/{slug}")
def list_drafts(slug: str):
    drafts = blob_storage.list_artifacts(slug, namespace=DRAFTS_NS)
    return {"slug": slug, "drafts": drafts}


# ── Approve (move blob drafts/{slug}/{phase} → features/{slug}/{phase}) ───────

@app.post("/approve/{slug}/{phase}")
def approve(slug: str, phase: str):
    _check_phase(phase)

    content = blob_storage.get_artifact(slug, phase, namespace=DRAFTS_NS)
    if content is None:
        raise HTTPException(404, "sem draft para aprovar")

    blob_url = blob_storage.save_artifact(slug, phase, content, namespace=FEATURES_NS)
    if blob_url:
        logger.debug("Artefato aprovado em: %s", blob_url)
    blob_storage.delete_artifact(slug, phase, namespace=DRAFTS_NS)
    # Conteúdo movido drafts → features: invalida hidratação pra próximo /ensure
    # refletir o novo estado aprovado no sandbox.
    daytona_manager.invalidate_hydration(slug)

    if phase == "TAREFAS":
        approved = [p for p in blob_storage.list_artifacts(slug, namespace=FEATURES_NS) if p in PHASES]
        if len(approved) >= len(PHASES):
            # Snapshot do /repo antes de encerrar o sandbox — necessário para o ZIP.
            try:
                tree = daytona_manager.exec_repo_find(slug)
                if tree:
                    blob_storage.save_artifact(slug, REPO_TREE_KEY, tree, namespace=FEATURES_NS)
            except Exception as exc:
                logger.warning("Falha ao gerar snapshot do /repo para '%s': %s", slug, exc)

            try:
                daytona_manager.complete(slug)
            except Exception:
                pass  # aprovação não falha se cleanup falhar

    return {"ok": True, "blob_url": blob_url}


# ── Artifacts (aprovados — lidos via BlobStorage) ─────────────────────────────

@app.get("/artifacts")
def list_features():
    from storage.factory import FEATURES_DIR
    if not FEATURES_DIR.exists():
        return {"features": []}
    return {"features": sorted(p.name for p in FEATURES_DIR.iterdir() if p.is_dir())}


@app.get("/artifacts/{slug}")
def list_feature_artifacts(slug: str):
    # REPO_TREE é metadata interna (snapshot do /repo), não conta como phase.
    artifacts = [p for p in blob_storage.list_artifacts(slug) if p in PHASES]
    return {"slug": slug, "artifacts": artifacts}


def _build_readme(slug: str, generated_at: str) -> str:
    return (
        f"# {slug} — Documentação SDD\n\n"
        f"**Gerado em:** {generated_at}\n\n"
        "Este pacote contém os 5 artefatos do pipeline Software Design Document\n"
        "gerados pelo Champion AI em modo brownfield (com acesso ao código real\n"
        "do repositório via sandbox Daytona).\n\n"
        "## Ordem de leitura sugerida\n\n"
        "1. **CONSTITUICAO.md** — visão, objetivos, stakeholders, princípios\n"
        "2. **PRD.md** — Product Requirements Document (BR-XXX)\n"
        "3. **ESPECIFICACAO.md** — User stories e requisitos funcionais (FR-XXX)\n"
        "4. **PLANO.md** — arquitetura técnica e decisões\n"
        "5. **TAREFAS.md** — tarefas atômicas com conventional commits\n\n"
        "## Arquivos auxiliares\n\n"
        "- `manifest.json` — metadados do pacote (slug, datas, sha256 por fase)\n"
        "- `repo-tree.txt` — snapshot dos arquivos do repositório no momento da geração\n"
    )


@app.get("/artifacts/{slug}/zip")
def download_zip(slug: str):
    """Empacota os 5 artefatos aprovados + manifest + README + repo-tree em ZIP.

    Requer todas as 5 fases aprovadas (409 caso contrário).
    Filename: {slug}-{YYYY-MM-DD}.zip
    """
    approved = [p for p in blob_storage.list_artifacts(slug) if p in PHASES]
    missing = sorted(PHASES - set(approved))
    if missing:
        raise HTTPException(
            409,
            f"Pipeline incompleto. Faltam: {', '.join(missing)}",
        )

    now = datetime.now(timezone.utc)
    generated_at = now.isoformat()
    today = now.strftime("%Y-%m-%d")
    folder = slug

    manifest: dict = {
        "slug": slug,
        "generated_at": generated_at,
        "phases": [],
    }

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(f"{folder}/README.md", _build_readme(slug, generated_at))

        for phase in PHASE_ORDER:
            content = blob_storage.get_artifact(slug, phase) or ""
            zf.writestr(f"{folder}/{phase}.md", content)
            encoded = content.encode("utf-8")
            manifest["phases"].append({
                "phase": phase,
                "size_bytes": len(encoded),
                "sha256": hashlib.sha256(encoded).hexdigest(),
            })

        repo_tree = blob_storage.get_artifact(slug, REPO_TREE_KEY)
        if repo_tree:
            zf.writestr(f"{folder}/repo-tree.txt", repo_tree)
            manifest["repo_tree_lines"] = repo_tree.count("\n") + 1
        else:
            zf.writestr(
                f"{folder}/repo-tree.txt",
                "(snapshot indisponível — o sandbox foi encerrado antes da captura ou "
                "o exec do find falhou; nenhum arquivo do repositório clonado foi registrado.)\n",
            )
            manifest["repo_tree_lines"] = 0

        zf.writestr(
            f"{folder}/manifest.json",
            json.dumps(manifest, indent=2, ensure_ascii=False),
        )

    buf.seek(0)
    filename = f"{slug}-{today}.zip"
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/artifacts/{slug}/{phase}")
def read_artifact(slug: str, phase: str):
    if phase not in PHASES:
        raise HTTPException(400, f"phase inválido: deve ser um de {sorted(PHASES)}")
    content = blob_storage.get_artifact(slug, phase)
    if content is None:
        raise HTTPException(404, "artefato aprovado não encontrado")
    return {"content": content}


# ── Clarification sessions (human-in-the-loop) ────────────────────────────────

class ClarificationAnswers(BaseModel):
    answers: list


@app.get("/clarifications/{thread_id}")
def get_clarification_session(thread_id: str):
    """Polled pelo frontend a cada 10s enquanto o agente está rodando.
    Retorna as perguntas quando o agente chama ask_user, ou status 'none'.
    """
    from db import get_clarification
    row = get_clarification(thread_id)
    if row is None or row["status"] != "pending":
        return {"status": "none"}
    try:
        questions = json.loads(row["questions"])
    except Exception:
        return {"status": "none"}
    return {"status": "pending", "questions": questions}


@app.post("/clarifications/{thread_id}/answers")
def post_clarification_answers(thread_id: str, body: ClarificationAnswers):
    """Chamado pelo frontend quando o usuário submete respostas no ClarificationDialog."""
    from db import get_clarification, set_clarification_answers
    row = get_clarification(thread_id)
    if row is None or row["status"] != "pending":
        raise HTTPException(404, "Sem sessão de clarificação pendente para este thread.")
    try:
        questions = json.loads(row["questions"])
    except Exception:
        raise HTTPException(500, "Perguntas malformadas no banco de dados.")
    if len(body.answers) != len(questions):
        raise HTTPException(
            400,
            f"Esperado {len(questions)} respostas, recebido {len(body.answers)}.",
        )
    if not set_clarification_answers(thread_id, body.answers):
        raise HTTPException(409, "Sessão já respondida ou expirada.")
    return {"ok": True}
