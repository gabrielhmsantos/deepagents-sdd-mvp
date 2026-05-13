"""LLM provider adapter pattern — see ports.py for the contract.

Public surface:
    from agents.llm import create_llm_provider, LLMProvider
"""
from agents.llm.factory import create_llm_provider
from agents.llm.ports import LLMProvider

__all__ = ["create_llm_provider", "LLMProvider"]
