"""Adapter contract for LLM providers consumed by deepagents.

Translated from be-champion-ai's `ports/llm-provider.ts`, mas adaptado pra
LangGraph/deepagents: o adapter NÃO executa completions — devolve um
LangChain BaseChatModel configurado, que o deepagents.create_deep_agent
owns daí em diante (streaming, tool loop, etc. são internos do LangGraph).
"""
from __future__ import annotations
from typing import Protocol, runtime_checkable

from langchain_core.language_models.chat_models import BaseChatModel


@runtime_checkable
class LLMProvider(Protocol):
    """Devolve um chat model LangChain configurado pro deepagents."""

    def build_chat_model(self, *, max_output_tokens: int) -> BaseChatModel:
        """Constrói e devolve a instância do chat model.

        Args:
            max_output_tokens: Teto de tokens por resposta. O adapter
                traduz isso pro kwarg que o cliente subjacente espera
                (max_tokens, max_completion_tokens, etc.).
        """
        ...
