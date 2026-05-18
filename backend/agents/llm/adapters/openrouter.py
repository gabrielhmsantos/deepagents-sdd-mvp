"""Adapter OpenRouter — preserva o caminho pré-migração com init_chat_model
+ ProviderProfile do deepagents (atribuição de app, ignore-azure header,
version check)."""
from __future__ import annotations
import os

from langchain.chat_models import init_chat_model
from langchain_core.language_models.chat_models import BaseChatModel
from deepagents.profiles.provider.provider_profiles import apply_provider_profile


class OpenRouterAdapter:
    """Constrói ChatOpenRouter via init_chat_model + provider profile."""

    def __init__(self) -> None:
        # MODEL mantém o significado pré-migração: spec completa
        # "openrouter:<vendor>/<model>[:tag]".
        self._spec = os.environ.get("MODEL", "openrouter:minimax/minimax-m2.7")

    def build_chat_model(self, *, max_output_tokens: int) -> BaseChatModel:
        return init_chat_model(
            self._spec,
            **apply_provider_profile(self._spec, {"max_tokens": max_output_tokens}),
        )
