"""Discriminador de provider. Static at process startup — sem DI container,
espelhando o singleton config do be-champion-ai. Default = openrouter pra
preservar backward-compat; opera o switch via LLM_PROVIDER=azure."""
from __future__ import annotations
import logging
import os

from agents.llm.adapters import AzureOpenAIAdapter, OpenRouterAdapter
from agents.llm.ports import LLMProvider

logger = logging.getLogger(__name__)

_DEFAULT_PROVIDER = "openrouter"


def create_llm_provider() -> LLMProvider:
    """Devolve o LLMProvider configurado pra esse processo."""
    raw = os.environ.get("LLM_PROVIDER", _DEFAULT_PROVIDER).strip().lower()
    logger.info("LLM_PROVIDER=%s", raw)
    if raw == "openrouter":
        return OpenRouterAdapter()
    if raw in {"azure", "azure_openai"}:
        return AzureOpenAIAdapter()
    raise ValueError(
        f"LLM_PROVIDER desconhecido: {raw!r}. Esperado um de: 'openrouter', 'azure'."
    )
