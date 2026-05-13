"""Cria a instância correta de BlobStorage com base nas variáveis de ambiente.

Comportamento:
  - AZURE_STORAGE_CONNECTION_STRING ausente/vazio → NoopBlobAdapter (filesystem local)
  - AZURE_STORAGE_CONNECTION_STRING presente     → AzureBlobAdapter (Azure real)

Sinal de migração para produção: basta definir a env var.
"""
import os
from pathlib import Path

from .ports import BlobStorage

FEATURES_DIR = Path(__file__).parents[2] / ".specs" / "features"


def create_blob_storage() -> BlobStorage:
    conn_str = os.environ.get("AZURE_STORAGE_CONNECTION_STRING", "").strip()
    if conn_str:
        from .adapters.azure import AzureBlobAdapter
        return AzureBlobAdapter(conn_str)
    from .adapters.noop import NoopBlobAdapter
    return NoopBlobAdapter(FEATURES_DIR)
