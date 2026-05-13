import logging
import os
import re
from pathlib import Path
from typing import Annotated, TypedDict

from langchain.chat_models import init_chat_model
from langchain_core.messages import AnyMessage, HumanMessage
from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages
from langgraph.types import RunnableConfig
from deepagents import create_deep_agent
from deepagents.backends.filesystem import FilesystemBackend
from deepagents.profiles.provider.provider_profiles import apply_provider_profile

logger = logging.getLogger(__name__)

MODEL = os.environ.get("MODEL", "openrouter:minimax/minimax-m2.7")
MODEL_CONTEXT_WINDOW = int(os.environ.get("MODEL_CONTEXT_WINDOW", "32000"))
PROJECT_ROOT = Path(__file__).parents[2]
PROMPTS_DIR = PROJECT_ROOT / "prompts"
SPECS_DIR = PROJECT_ROOT / ".specs"

PHASE_ORDER = ["CONSTITUICAO", "PRD", "ESPECIFICACAO", "PLANO", "TAREFAS"]

_SAVE_INSTRUCTION = """

---

## INSTRUÇÃO DE SAÍDA

Ao concluir a geração do artefato, use a ferramenta `write_file` para salvar o conteúdo no caminho exato indicado em `[SALVAR EM]` da mensagem do usuário.

Regras obrigatórias:
- Use o caminho **exatamente como fornecido** em `[SALVAR EM]` (não converta para absoluto).
- O conteúdo do arquivo deve ser o artefato markdown completo, sem preâmbulo nem comentários extras.
"""

_RETRY_MESSAGE = (
    "Você não salvou o artefato. "
    "Use a ferramenta write_file (geração inicial) ou edit_file (edição) "
    "para salvar no caminho exato indicado em [SALVAR EM]. "
    "Não responda com texto — salve o arquivo diretamente."
)

MAX_RETRIES = 2


class WrapperState(TypedDict):
    messages: Annotated[list[AnyMessage], add_messages]
    retry_count: int


def _resolve_backend(slug: str | None) -> tuple:
    """Retorna (CompositeBackend, repo_path).

    Exige sandbox Daytona ativo para o slug. Falha explicitamente se ausente.
    """
    if not slug:
        raise ValueError("slug não informado no config do run.")

    from daytona import manager
    from deepagents.backends.composite import CompositeBackend

    daytona_backend, repo_path = manager.get(slug)
    if daytona_backend is None:
        raise ValueError(
            f"Nenhum sandbox ativo para o slug '{slug}'. "
            "Crie um sandbox com o repositório antes de gerar artefatos."
        )

    composite = CompositeBackend(
        default=FilesystemBackend(str(SPECS_DIR), virtual_mode=True),
        routes={"/repo/": daytona_backend},
    )
    return composite, repo_path


def _codebase_block(repo_path: str) -> str:
    return f"""

---

## CONTEXTO DO REPOSITÓRIO (MODO BROWNFIELD)

[CODEBASE]
O repositório do projeto foi clonado em `{repo_path}`.
Use as ferramentas `ls`, `grep` e `read_file` com caminhos `/repo/...` para explorar o código real **antes** de gerar o artefato.

Exemplos:
- `ls /repo` — lista raiz do projeto
- `grep "class " /repo/src` — busca definições de classe
- `read_file /repo/README.md` — lê o README
- `glob "**/*.py" /repo` — lista todos os arquivos Python

O artefato gerado deve referenciar arquivos e estruturas reais encontrados no repositório.
"""


def _previous_artifacts_block(slug: str, current_phase: str) -> str:
    """Bloco de contexto com manifesto das fases prévias + predecessor imediato em texto integral.

    Balanço entre token-eficiência (read_file sob demanda) e garantia (predecessor sempre presente).
    Retorna string vazia se for a primeira fase ou se nenhuma anterior foi aprovada.
    """
    if current_phase not in PHASE_ORDER:
        return ""
    idx = PHASE_ORDER.index(current_phase)
    if idx == 0:
        return ""

    from storage.factory import create_blob_storage

    blob = create_blob_storage()
    approved_set = set(blob.list_artifacts(slug))
    previous_approved = [p for p in PHASE_ORDER[:idx] if p in approved_set]
    if not previous_approved:
        return ""

    immediate = previous_approved[-1]
    older = previous_approved[:-1]

    parts: list[str] = ["\n\n---\n\n## ARTEFATOS PRÉVIOS APROVADOS\n"]
    if older:
        parts.append(
            "**Anteriores (use `read_file` para o conteúdo completo quando precisar):**"
        )
        for p in older:
            parts.append(f"- {p} → `features/{slug}/{p}.md`")
        parts.append("")

    parts.append(
        f"**Predecessor imediato (incluído integralmente abaixo — também disponível em "
        f"`features/{slug}/{immediate}.md`):**\n"
    )
    parts.append(f"### {immediate}\n")
    content = blob.get_artifact(slug, immediate) or "(conteúdo indisponível)"
    parts.append(content)

    return "\n".join(parts)


def _get_draft_path(messages: list) -> Path | None:
    for m in messages:
        content = m.content if hasattr(m, "content") else m.get("content", "")
        if not isinstance(content, str):
            continue
        match = re.search(r"\[SALVAR EM\]\s*\n(?:\.specs/)?(drafts/.+\.md)", content)
        if match:
            return SPECS_DIR / match.group(1).strip()
    return None


def make_agent(prompt_filename: str):
    base_prompt = (PROMPTS_DIR / prompt_filename).read_text(encoding="utf-8")
    phase = prompt_filename.removesuffix(".md").upper()

    def run_agent(state: WrapperState, config: RunnableConfig) -> dict:
        slug = (config.get("configurable") or {}).get("slug")
        attempt = state.get("retry_count", 0) + 1
        logger.info(
            "[%s] run_agent attempt=%d slug=%s msgs_in=%d",
            phase, attempt, slug, len(state["messages"]),
        )
        backend, repo_path = _resolve_backend(slug)

        system_prompt = base_prompt + _SAVE_INSTRUCTION
        if repo_path:
            system_prompt += _codebase_block(repo_path)
        if slug:
            system_prompt += _previous_artifacts_block(slug, phase)

        _model = init_chat_model(
            MODEL,
            **apply_provider_profile(MODEL, {"max_tokens": MODEL_CONTEXT_WINDOW}),
        )
        deep_agent = create_deep_agent(
            model=_model,
            system_prompt=system_prompt,
            backend=backend,
            skills=["backend/skills"],
        )
        logger.info("[%s] invoking deep_agent (system_prompt=%d chars)",
                    phase, len(system_prompt))
        try:
            result = deep_agent.invoke({"messages": state["messages"]})
        except Exception as exc:
            logger.exception("[%s] deep_agent.invoke RAISED: %s", phase, exc)
            raise

        # Observabilidade: loga toda tool-call e tool-result emitida nesta invocação.
        # Slice em new_messages evita relog em retries — só o delta desta attempt.
        new_messages = result["messages"][len(state["messages"]):]
        for m in new_messages:
            tool_calls = getattr(m, "tool_calls", None) or []
            for tc in tool_calls:
                if isinstance(tc, dict):
                    name = tc.get("name", "?")
                    args = tc.get("args", {})
                else:
                    name = getattr(tc, "name", "?")
                    args = getattr(tc, "args", {})
                args_str = str(args)[:240]
                logger.info("[%s] tool_call name=%s args=%s", phase, name, args_str)
            msg_type = getattr(m, "type", "") or type(m).__name__
            if msg_type == "tool" or (getattr(m, "name", None) and not tool_calls):
                content = getattr(m, "content", "")
                content_str = (content if isinstance(content, str) else str(content))[:240]
                logger.info("[%s] tool_result name=%s -> %s",
                            phase, getattr(m, "name", "?"), content_str)

        logger.info("[%s] deep_agent done, msgs_out=%d", phase, len(result["messages"]))
        return {
            "messages": result["messages"],
            "retry_count": attempt,
        }

    def inject_retry(state: WrapperState) -> dict:
        """Nó real que injeta a mensagem de retry — em conditional edges a mutação
        de state['messages'] não propaga, então isso precisa ser um update real."""
        logger.info("[%s] inject_retry attempt=%d", phase, state.get("retry_count", 0))
        return {"messages": [HumanMessage(content=_RETRY_MESSAGE)]}

    def route_after_run(state: WrapperState) -> str:
        draft = _get_draft_path(state["messages"])
        file_ok = draft is not None and draft.exists() and draft.stat().st_size > 100
        rc = state.get("retry_count", 0)
        logger.info(
            "[%s] route_after_run draft=%s exists=%s size=%s retry_count=%d",
            phase,
            str(draft) if draft else "None",
            draft.exists() if draft else False,
            draft.stat().st_size if (draft and draft.exists()) else 0,
            rc,
        )
        if file_ok or rc >= MAX_RETRIES:
            return END
        return "inject_retry"

    workflow = StateGraph(WrapperState)
    workflow.add_node("run_agent", run_agent)
    workflow.add_node("inject_retry", inject_retry)
    workflow.set_entry_point("run_agent")
    workflow.add_conditional_edges("run_agent", route_after_run,
                                   {END: END, "inject_retry": "inject_retry"})
    workflow.add_edge("inject_retry", "run_agent")

    return workflow.compile()
