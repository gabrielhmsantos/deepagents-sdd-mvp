import shutil
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from uploads import router as uploads_router

SPECS = Path(__file__).parent.parent / ".specs"
DRAFTS = SPECS / "drafts"
FEATURES = SPECS / "features"
PHASES = {"CONSTITUICAO", "PRD", "ESPECIFICACAO", "PLANO", "TAREFAS"}

app = FastAPI(title="Champion AI — SDD Artifacts API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:4173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(uploads_router)


class Artifact(BaseModel):
    content: str


def _path(root: Path, slug: str, phase: str) -> Path:
    if phase not in PHASES:
        raise HTTPException(400, f"phase inválido: deve ser um de {sorted(PHASES)}")
    return root / slug / f"{phase}.md"


# ── Drafts ────────────────────────────────────────────────────────────────────

@app.put("/drafts/{slug}/{phase}")
def write_draft(slug: str, phase: str, body: Artifact):
    p = _path(DRAFTS, slug, phase)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(body.content, encoding="utf-8")
    return {"ok": True, "path": str(p)}


@app.get("/drafts/{slug}/{phase}")
def read_draft(slug: str, phase: str):
    p = _path(DRAFTS, slug, phase)
    if not p.exists():
        raise HTTPException(404, "draft não encontrado")
    return {"content": p.read_text(encoding="utf-8")}


@app.delete("/drafts/{slug}/{phase}")
def delete_draft(slug: str, phase: str):
    p = _path(DRAFTS, slug, phase)
    if p.exists():
        p.unlink()
    return {"ok": True}


@app.get("/drafts/{slug}")
def list_drafts(slug: str):
    folder = DRAFTS / slug
    if not folder.exists():
        return {"slug": slug, "drafts": []}
    return {"slug": slug, "drafts": sorted(p.stem for p in folder.glob("*.md"))}


# ── Approve ───────────────────────────────────────────────────────────────────

@app.post("/approve/{slug}/{phase}")
def approve(slug: str, phase: str):
    src = _path(DRAFTS, slug, phase)
    dst = _path(FEATURES, slug, phase)
    if not src.exists():
        raise HTTPException(404, "sem draft para aprovar")
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(str(src), str(dst))
    src.unlink()
    return {"ok": True, "path": str(dst)}


# ── Artifacts (aprovados) ─────────────────────────────────────────────────────

@app.get("/artifacts")
def list_features():
    if not FEATURES.exists():
        return {"features": []}
    return {"features": sorted(p.name for p in FEATURES.iterdir() if p.is_dir())}


@app.get("/artifacts/{slug}")
def list_feature_artifacts(slug: str):
    folder = FEATURES / slug
    if not folder.exists():
        return {"slug": slug, "artifacts": []}
    return {"slug": slug, "artifacts": sorted(p.stem for p in folder.glob("*.md"))}


@app.get("/artifacts/{slug}/{phase}")
def read_artifact(slug: str, phase: str):
    p = _path(FEATURES, slug, phase)
    if not p.exists():
        raise HTTPException(404, "artefato aprovado não encontrado")
    return {"content": p.read_text(encoding="utf-8")}
