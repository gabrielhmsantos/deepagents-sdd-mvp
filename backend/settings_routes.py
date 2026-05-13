from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from db import get_setting, set_setting

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("/github-pat")
def get_github_pat():
    pat = get_setting("github_pat")
    if not pat:
        return {"configured": False, "masked": None}
    masked = "****" + pat[-4:] if len(pat) >= 4 else "****"
    return {"configured": True, "masked": masked}


class PATBody(BaseModel):
    pat: str


@router.put("/github-pat")
def save_github_pat(body: PATBody):
    if not body.pat.strip():
        raise HTTPException(422, "PAT não pode ser vazio")
    set_setting("github_pat", body.pat.strip())
    return {"ok": True}
