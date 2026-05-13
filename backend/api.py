import hashlib
import io
import json
import logging
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

SPECS = Path(__file__).parent.parent / ".specs"
DRAFTS = SPECS / "drafts"
PHASES = {"CONSTITUICAO", "PRD", "ESPECIFICACAO", "PLANO", "TAREFAS"}
PHASE_ORDER = ["CONSTITUICAO", "PRD", "ESPECIFICACAO", "PLANO", "TAREFAS"]
REPO_TREE_KEY = "REPO_TREE"  # entrada interna no blob storage (não é uma phase)

app = FastAPI(title="Champion AI — SDD Artifacts API")
init_db()
blob_storage = create_blob_storage()

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


def _draft_path(slug: str, phase: str) -> Path:
    if phase not in PHASES:
        raise HTTPException(400, f"phase inválido: deve ser um de {sorted(PHASES)}")
    return DRAFTS / slug / f"{phase}.md"


# ── Drafts (filesystem — temporários, não passam pelo BlobStorage) ─────────────

@app.put("/drafts/{slug}/{phase}")
def write_draft(slug: str, phase: str, body: Artifact):
    p = _draft_path(slug, phase)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(body.content, encoding="utf-8")
    return {"ok": True}


@app.get("/drafts/{slug}/{phase}")
def read_draft(slug: str, phase: str):
    p = _draft_path(slug, phase)
    if not p.exists():
        return {"exists": False, "content": None}
    return {"exists": True, "content": p.read_text(encoding="utf-8")}


@app.delete("/drafts/{slug}/{phase}")
def delete_draft(slug: str, phase: str):
    p = _draft_path(slug, phase)
    if p.exists():
        p.unlink()
        # Remove drafts/{slug}/ se ficou vazia. rmdir falha (OSError) se ainda
        # houver outros drafts pendentes — ok, silenciar.
        try:
            p.parent.rmdir()
        except OSError:
            pass
    return {"ok": True}


@app.get("/drafts/{slug}")
def list_drafts(slug: str):
    folder = DRAFTS / slug
    if not folder.exists():
        return {"slug": slug, "drafts": []}
    return {"slug": slug, "drafts": sorted(p.stem for p in folder.glob("*.md"))}


# ── Approve ────────────────────────────────────────────────────────────────────

@app.post("/approve/{slug}/{phase}")
def approve(slug: str, phase: str):
    src = _draft_path(slug, phase)
    if not src.exists():
        raise HTTPException(404, "sem draft para aprovar")

    content = src.read_text(encoding="utf-8")
    blob_url = blob_storage.save_artifact(slug, phase, content)
    if blob_url:
        logger.debug("Artefato salvo em: %s", blob_url)

    src.unlink()
    # Remove drafts/{slug}/ se ficou vazia após approve. rmdir falha (OSError)
    # se ainda houver outros drafts pendentes — ok, silenciar.
    try:
        src.parent.rmdir()
    except OSError:
        pass

    if phase == "TAREFAS":
        approved = [p for p in blob_storage.list_artifacts(slug) if p in PHASES]
        if len(approved) >= len(PHASES):
            # Snapshot do /repo antes de encerrar o sandbox — necessário para o ZIP.
            try:
                tree = daytona_manager.exec_repo_find(slug)
                if tree:
                    blob_storage.save_artifact(slug, REPO_TREE_KEY, tree)
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
