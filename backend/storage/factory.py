"""Cria a instância correta de BlobStorage com base nas variáveis de ambiente.

Comportamento:
  - AZURE_STORAGE_CONNECTION_STRING ausente/vazio → NoopBlobAdapter (filesystem local)
  - AZURE_STORAGE_CONNECTION_STRING presente     → AzureBlobAdapter (Azure real)

Sinal de migração para produção: basta definir a env var.

Singleton: a instância é cacheada por processo. Reconstruir um AzureBlobAdapter
a cada chamada custa centenas de ms (BlobServiceClient.from_connection_string +
_ensure_container HTTP call) e estourava a TTL de idempotência do /ensure
(Estado B precisa rodar em < 2s). O singleton também é seguro para o
NoopBlobAdapter — não há estado mutável compartilhado.
"""
import os
import threading
from pathlib import Path

from .ports import BlobStorage

# Base local que espelha o root do container Azure. Subpastas drafts/ e features/
# vivem aqui sob o nome do namespace passado pra cada chamada do BlobStorage.
LOCAL_BLOB_DIR = Path(__file__).parents[2] / ".specs"

# Compat: paths que ainda usam FEATURES_DIR pra enumerar diretamente o disco
# (ex.: api.list_features). Sob o blob real isso seria substituído por uma
# operação de listagem do container — fora do escopo da Fase 2.
FEATURES_DIR = LOCAL_BLOB_DIR / "features"

_BLOB_INSTANCE: BlobStorage | None = None
_BLOB_LOCK = threading.Lock()


def create_blob_storage() -> BlobStorage:
    global _BLOB_INSTANCE
    if _BLOB_INSTANCE is not None:
        return _BLOB_INSTANCE
    with _BLOB_LOCK:
        if _BLOB_INSTANCE is not None:
            return _BLOB_INSTANCE
        conn_str = os.environ.get("AZURE_STORAGE_CONNECTION_STRING", "").strip()
        if conn_str:
            from .adapters.azure import AzureBlobAdapter
            _BLOB_INSTANCE = AzureBlobAdapter(conn_str)
        else:
            from .adapters.noop import NoopBlobAdapter
            _BLOB_INSTANCE = NoopBlobAdapter(LOCAL_BLOB_DIR)
        return _BLOB_INSTANCE


def reset_blob_storage() -> None:
    """Reset do singleton (uso em testes ou reload manual de env)."""
    global _BLOB_INSTANCE
    with _BLOB_LOCK:
        _BLOB_INSTANCE = None
