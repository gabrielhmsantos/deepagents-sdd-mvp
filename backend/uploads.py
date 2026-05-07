import asyncio
from pathlib import Path

from docx import Document
from fastapi import APIRouter, File, HTTPException, UploadFile
from pypdf import PdfReader

UPLOADS = Path(__file__).parent.parent / ".specs" / "uploads"
ALLOWED = {".pdf", ".docx", ".txt", ".md"}
MAX_BYTES = 10 * 1024 * 1024  # 10 MB

router = APIRouter()


def _extract_text(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in {".txt", ".md"}:
        return path.read_text(encoding="utf-8")
    if suffix == ".pdf":
        reader = PdfReader(str(path))
        return "\n\n".join(page.extract_text() or "" for page in reader.pages)
    if suffix == ".docx":
        doc = Document(str(path))
        return "\n\n".join(p.text for p in doc.paragraphs if p.text.strip())
    raise HTTPException(400, f"formato não suportado: {suffix}")


@router.post("/uploads/{slug}")
async def upload_file(slug: str, file: UploadFile = File(...)):
    filename = file.filename or "upload"
    suffix = Path(filename).suffix.lower()
    if suffix not in ALLOWED:
        raise HTTPException(400, f"formato não suportado — aceitos: {', '.join(sorted(ALLOWED))}")
    data = await file.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "arquivo excede o limite de 10 MB")

    folder = UPLOADS / slug
    await asyncio.to_thread(folder.mkdir, parents=True, exist_ok=True)

    bin_path = folder / filename
    await asyncio.to_thread(bin_path.write_bytes, data)

    text = await asyncio.to_thread(_extract_text, bin_path)
    txt_path = folder / f"{filename}.txt"
    await asyncio.to_thread(txt_path.write_text, text, "utf-8")

    return {
        "filename": filename,
        "bytes": len(data),
        "extracted_chars": len(text),
        "approx_tokens": len(text) // 4,
    }


@router.get("/uploads/{slug}")
def list_uploads(slug: str):
    folder = UPLOADS / slug
    if not folder.exists():
        return {"slug": slug, "files": []}
    files = [
        p.name
        for p in folder.iterdir()
        if p.is_file() and not p.name.endswith(".txt")
    ]
    return {"slug": slug, "files": sorted(files)}


@router.get("/uploads/{slug}/{filename}")
def read_extracted(slug: str, filename: str):
    txt_path = UPLOADS / slug / f"{filename}.txt"
    if not txt_path.exists():
        raise HTTPException(404, "texto extraído não encontrado")
    text = txt_path.read_text(encoding="utf-8")
    return {
        "filename": filename,
        "content": text,
        "approx_tokens": len(text) // 4,
    }


@router.delete("/uploads/{slug}/{filename}")
def delete_upload(slug: str, filename: str):
    folder = UPLOADS / slug
    removed = []
    for p in [folder / filename, folder / f"{filename}.txt"]:
        if p.exists():
            p.unlink()
            removed.append(p.name)
    if not removed:
        raise HTTPException(404, "arquivo não encontrado")
    return {"ok": True, "removed": removed}
