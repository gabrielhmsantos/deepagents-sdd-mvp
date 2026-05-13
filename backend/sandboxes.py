import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from daytona import _DEAD_STATES, _RESTARTABLE_STATES, _RUNNING_STATES, manager
from db import count_active_sandboxes

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/sandboxes", tags=["sandboxes"])

SANDBOX_LIMIT = 10


class SandboxRequest(BaseModel):
    repo_url: str | None = None
    branch: str = "main"


class ExecRequest(BaseModel):
    command: str
    timeout: int | None = None


@router.post("/{slug}", status_code=201)
def create_sandbox(slug: str, body: SandboxRequest):
    if count_active_sandboxes() >= SANDBOX_LIMIT:
        raise HTTPException(
            429,
            f"Limite de {SANDBOX_LIMIT} sandboxes atingido. Encerre um projeto antes de criar outro.",
        )
    try:
        backend, repo_path = manager.create(slug, repo_url=body.repo_url, branch=body.branch)
    except RuntimeError as e:
        raise HTTPException(422, str(e))
    except Exception as e:
        logger.exception("Erro ao criar sandbox '%s': %s", slug, e)
        raise HTTPException(500, f"Erro ao criar sandbox: {str(e)}")
    return {"ok": True, "sandbox_id": backend.id, "repo_path": repo_path}


_IDLE_RESPONSE = {
    "exists": False,
    "status": "idle",
    "sandbox_id": None,
    "repo_path": None,
}


@router.get("/{slug}")
def get_sandbox(slug: str):
    """Retorna sempre 200. `exists=false, status=idle` quando não há sandbox usável.

    Os ramos antes 404 (inexistente, inacessível, dead, falha ao acordar) colapsam
    em "idle" — do ponto de vista do front isso já era tratado como idle via !res.ok.
    """
    backend, repo_path = manager.get(slug)
    if backend is None:
        return _IDLE_RESPONSE

    state = manager.get_state(slug)
    if state is None:
        manager.remove(slug)
        return _IDLE_RESPONSE

    if state in _DEAD_STATES:
        manager.remove(slug)
        return _IDLE_RESPONSE

    if state in _RESTARTABLE_STATES:
        try:
            manager.wake(slug)
        except Exception as exc:
            logger.warning("Falha ao acordar sandbox '%s': %s", slug, exc)
            manager.remove(slug)
            return _IDLE_RESPONSE
        return {
            "exists": True,
            "status": "restarting",
            "sandbox_id": backend.id,
            "repo_path": repo_path,
        }

    return {
        "exists": True,
        "status": "ready",
        "sandbox_id": backend.id,
        "repo_path": repo_path,
    }


@router.delete("/{slug}")
def remove_sandbox(slug: str):
    removed = manager.remove(slug)
    if not removed:
        raise HTTPException(404, "sandbox não encontrado")
    return {"ok": True}


@router.post("/{slug}/exec")
def exec_command(slug: str, body: ExecRequest):
    backend, _ = manager.get(slug)
    if backend is None:
        raise HTTPException(404, "sandbox não encontrado")
    result = backend.execute(body.command, timeout=body.timeout)
    return {"output": result.output, "exit_code": result.exit_code}
