"""Adapter Azure OpenAI — constrói AzureChatOpenAI diretamente porque o
deepagents não tem ProviderProfile pra `azure_openai` (apply_provider_profile
seria no-op). Schema de env-vars espelha o AzureOpenAIAdapter do
be-champion-ai (resourceName + deployment + apiKey + apiVersion)."""
from __future__ import annotations
import os

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_openai import AzureChatOpenAI


# Família gpt-5.x na Azure rejeita `max_tokens` — usa max_completion_tokens
# (Responses API). Deployment names tipicamente incluem o nome da família.
_USES_MAX_COMPLETION_TOKENS_PREFIXES = ("gpt-5", "o1", "o3", "o4")


def _is_completion_tokens_family(deployment: str) -> bool:
    name = deployment.lower()
    return any(name.startswith(p) for p in _USES_MAX_COMPLETION_TOKENS_PREFIXES)


class AzureOpenAIAdapter:
    """Constrói AzureChatOpenAI a partir das env vars AZURE_OPENAI_*."""

    def __init__(self) -> None:
        self._resource = _require_env("AZURE_OPENAI_RESOURCE_NAME")
        self._deployment = _require_env("AZURE_OPENAI_DEPLOYMENT")
        self._api_key = _require_env("AZURE_OPENAI_API_KEY")
        self._api_version = _require_env("AZURE_OPENAI_API_VERSION")
        # Mesma forma que createAzure({resourceName, useDeploymentBasedUrls:true})
        # do be-champion-ai.
        self._endpoint = f"https://{self._resource}.openai.azure.com"

    def build_chat_model(self, *, max_output_tokens: int) -> BaseChatModel:
        token_kwarg = (
            "max_completion_tokens"
            if _is_completion_tokens_family(self._deployment)
            else "max_tokens"
        )
        return AzureChatOpenAI(
            azure_endpoint=self._endpoint,
            azure_deployment=self._deployment,
            api_key=self._api_key,
            api_version=self._api_version,
            **{token_kwarg: max_output_tokens},
        )


def _require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(
            f"AzureOpenAIAdapter: env var {name!r} é obrigatória quando "
            "LLM_PROVIDER=azure"
        )
    return value
