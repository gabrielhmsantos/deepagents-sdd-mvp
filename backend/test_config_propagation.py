"""
Testa se o thread_id é propagado corretamente para tools dentro do deep_agent.

O bug: _factory.py chamava deep_agent.invoke(input) sem passar o config,
então o thread_id do run LangGraph nunca chegava às tools.

Este script valida o fix sem LLM real, usando um modelo fake que força
a chamada da tool `capture_config` e depois termina.
"""
import json
import sys
from typing import Any, Annotated

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, AnyMessage, BaseMessage, ToolCall
from langchain_core.outputs import ChatGeneration, ChatResult
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import InjectedToolArg, tool
from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages
from typing import TypedDict

sys.path.insert(0, "/home/gabriel/projects/champion-ai-deepagents/backend")

# ── tool que captura o config ────────────────────────────────────────────────

_captured_config: dict | None = None


@tool
def capture_config(
    probe: str,
    config: Annotated[RunnableConfig, InjectedToolArg],
) -> str:
    """Captura o config recebido e retorna thread_id e slug."""
    global _captured_config
    configurable = config.get("configurable") or {}
    _captured_config = {
        "thread_id": configurable.get("thread_id"),
        "slug": configurable.get("slug"),
    }
    return f"thread_id={_captured_config['thread_id']} slug={_captured_config['slug']}"


# ── modelo fake ──────────────────────────────────────────────────────────────

class _FakeModel(BaseChatModel):
    """
    Turno 1: emite tool_call para capture_config.
    Turno 2+: emite AIMessage final (sem tool calls).
    """
    _call_count: int = 0

    @property
    def _llm_type(self) -> str:
        return "fake"

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: Any = None,
        **kwargs: Any,
    ) -> ChatResult:
        self._call_count += 1
        if self._call_count == 1:
            ai_msg = AIMessage(
                content="",
                tool_calls=[
                    ToolCall(
                        name="capture_config",
                        args={"probe": "hello"},
                        id="tc-001",
                    )
                ],
            )
        else:
            ai_msg = AIMessage(content="done")
        return ChatResult(generations=[ChatGeneration(message=ai_msg)])

    def bind_tools(self, tools, **kwargs):
        return self


# ── wrapper graph (replica do _factory.py) ──────────────────────────────────

class WrapperState(TypedDict):
    messages: Annotated[list[AnyMessage], add_messages]


def _make_wrapper(pass_config: bool):
    """
    Cria a wrapper StateGraph que chama deep_agent.invoke().
    pass_config=True simula o FIX; False simula o BUG.
    """
    from deepagents import create_deep_agent

    def run_agent(state: WrapperState, config: RunnableConfig) -> dict:
        model = _FakeModel()
        deep_agent = create_deep_agent(
            model=model,
            tools=[capture_config],
            system_prompt="test",
        )
        if pass_config:
            result = deep_agent.invoke({"messages": state["messages"]}, config)
        else:
            result = deep_agent.invoke({"messages": state["messages"]})
        return {"messages": result["messages"]}

    wf = StateGraph(WrapperState)
    wf.add_node("run_agent", run_agent)
    wf.set_entry_point("run_agent")
    wf.add_edge("run_agent", END)
    return wf.compile()


# ── runner ───────────────────────────────────────────────────────────────────

def run_test(label: str, pass_config: bool, expected_thread_id: str):
    global _captured_config
    _captured_config = None

    graph = _make_wrapper(pass_config)
    config: RunnableConfig = {
        "configurable": {
            "thread_id": expected_thread_id,
            "slug": "test-slug",
        }
    }
    from langchain_core.messages import HumanMessage
    graph.invoke(
        {"messages": [HumanMessage(content="go")]},
        config,
    )

    got = (_captured_config or {}).get("thread_id")
    ok = got == expected_thread_id
    status = "✅ PASS" if ok else "❌ FAIL"
    print(f"{status}  [{label}]  expected={expected_thread_id!r}  got={got!r}")
    return ok


if __name__ == "__main__":
    print("=== test_config_propagation ===\n")

    r1 = run_test("BUG  — invoke sem config", pass_config=False, expected_thread_id="tid-123")
    r2 = run_test("FIX  — invoke com config", pass_config=True,  expected_thread_id="tid-123")

    print()
    if r2 and not r1:
        print("Resultado: fix confirmado — com config o thread_id chega na tool; sem config não chega.")
        sys.exit(0)
    elif r1 and r2:
        print("Ambos passaram — talvez o bug não fosse o que pensávamos.")
        sys.exit(1)
    else:
        print("Fix não funcionou — ambos falharam ou houve erro inesperado.")
        sys.exit(2)
