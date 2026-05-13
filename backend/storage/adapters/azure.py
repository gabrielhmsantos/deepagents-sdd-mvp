"""AzureBlobAdapter — implementação de produção com Azure Blob Storage.

Requer:
  - pip install azure-storage-blob
  - AZURE_STORAGE_CONNECTION_STRING no .env

Estrutura de blobs:
  features/{slug}/{PHASE}.md

Container padrão: champion-ai (criado automaticamente se não existir).
"""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

CONTAINER_NAME = "champion-ai"


class AzureBlobAdapter:
    def __init__(self, connection_string: str) -> None:
        from azure.storage.blob import BlobServiceClient  # optional dep

        self._client = BlobServiceClient.from_connection_string(connection_string)
        self._ensure_container()

    def _ensure_container(self) -> None:
        try:
            self._client.create_container(CONTAINER_NAME)
        except Exception:
            pass  # já existe

    def _blob_name(self, slug: str, phase: str) -> str:
        return f"features/{slug}/{phase.upper()}.md"

    def save_artifact(self, slug: str, phase: str, content: str) -> str | None:
        blob_name = self._blob_name(slug, phase)
        try:
            blob_client = self._client.get_blob_client(CONTAINER_NAME, blob_name)
            blob_client.upload_blob(content.encode("utf-8"), overwrite=True)
            return blob_client.url
        except Exception as exc:
            logger.warning("Azure blob upload falhou (continuando): %s", exc)
            return None

    def get_artifact(self, slug: str, phase: str) -> str | None:
        blob_name = self._blob_name(slug, phase)
        try:
            blob_client = self._client.get_blob_client(CONTAINER_NAME, blob_name)
            return blob_client.download_blob().readall().decode("utf-8")
        except Exception:
            return None

    def list_artifacts(self, slug: str) -> list[str]:
        try:
            container_client = self._client.get_container_client(CONTAINER_NAME)
            prefix = f"features/{slug}/"
            blobs = container_client.list_blobs(name_starts_with=prefix)
            return sorted(
                blob.name[len(prefix):].removesuffix(".md")
                for blob in blobs
                if blob.name.endswith(".md")
            )
        except Exception:
            return []

    def delete_artifact(self, slug: str, phase: str) -> None:
        blob_name = self._blob_name(slug, phase)
        try:
            blob_client = self._client.get_blob_client(CONTAINER_NAME, blob_name)
            blob_client.delete_blob()
        except Exception:
            pass
