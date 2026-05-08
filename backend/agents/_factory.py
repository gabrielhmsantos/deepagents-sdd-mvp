import os
import re
from pathlib import Path
from typing import Annotated, TypedDict

from langchain_core.messages import AnyMessage, HumanMessage
from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages
from deepagents import create_deep_agent
from deepagents.backends.filesystem import FilesystemBackend

MODEL = os.environ.get("MODEL", "openrouter:minimax/minimax-m2.7")
PROJECT_ROOT = Path(__file__).parents[2]   # champion-ai-deepagents/
PROMPTS_DIR = PROJECT_ROOT / "prompts"

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


SPECS_DIR = PROJECT_ROOT / ".specs"


def _get_draft_path(messages: list) -> Path | None:
    for m in messages:
        content = m.content if hasattr(m, "content") else m.get("content", "")
        if not isinstance(content, str):
            continue
        # Aceita tanto "drafts/..." (virtual, relativo a .specs/) quanto ".specs/drafts/..."
        match = re.search(r"\[SALVAR EM\]\s*\n(?:\.specs/)?(drafts/.+\.md)", content)
        if match:
            return SPECS_DIR / match.group(1).strip()
    return None


def make_agent(prompt_filename: str):
    base_prompt = (PROMPTS_DIR / prompt_filename).read_text(encoding="utf-8")

    deep_agent = create_deep_agent(
        model=MODEL,
        system_prompt=base_prompt + _SAVE_INSTRUCTION,
        # Restringe o agente a .specs/ — ele não precisa ver o restante do repositório
        backend=FilesystemBackend(root_dir=str(SPECS_DIR), virtual_mode=True),
        skills=["backend/skills"],
    )

    def run_agent(state: WrapperState) -> dict:
        result = deep_agent.invoke({"messages": state["messages"]})
        return {
            "messages": result["messages"],
            "retry_count": state.get("retry_count", 0) + 1,
        }

    def validate(state: WrapperState) -> str:
        draft = _get_draft_path(state["messages"])
        file_ok = draft is not None and draft.exists() and draft.stat().st_size > 100

        if file_ok or state.get("retry_count", 0) >= MAX_RETRIES:
            return END

        # Injeta mensagem de correção antes do próximo attempt
        state["messages"].append(HumanMessage(content=_RETRY_MESSAGE))
        return "run_agent"

    workflow = StateGraph(WrapperState)
    workflow.add_node("run_agent", run_agent)
    workflow.set_entry_point("run_agent")
    workflow.add_conditional_edges("run_agent", validate)

    return workflow.compile()
