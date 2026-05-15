"""Sandbox status (read-only) e command exec.

Step 2 reduziu este módulo:
  - DELETED: POST /sandboxes/{slug} (criação) — substituído por POST /projects
  - DELETED: DELETE /sandboxes/{slug}        — substituído por POST /cancel/{slug}
  - KEPT:    GET  /sandboxes/{slug}          — usado por App.tsx polling de status
  - KEPT:    POST /sandboxes/{slug}/exec     — usado por TerminalPanel.tsx
"""
import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from daytona import _DEAD_STATES, _RESTARTABLE_STATES, _RUNNING_STATES, manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/sandboxes", tags=["sandboxes"])


class ExecRequest(BaseModel):
    command: str
    timeout: int | None = None


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


@router.post("/{slug}/exec")
def exec_command(slug: str, body: ExecRequest):
    backend, _ = manager.get(slug)
    if backend is None:
        raise HTTPException(404, "sandbox não encontrado")
    result = backend.execute(body.command, timeout=body.timeout)
    return {"output": result.output, "exit_code": result.exit_code}
