from typing import Protocol, runtime_checkable


@runtime_checkable
class BlobStorage(Protocol):
    """Port: contrato de armazenamento de artefatos.

    Implementações:
      - NoopBlobAdapter  → filesystem local (dev/MVP sem Azure)
      - AzureBlobAdapter → Azure Blob Storage (produção)

    Namespace separa drafts em andamento (`drafts/`) de aprovados (`features/`).
    Default "features" preserva backward compat de callers anteriores à Fase 2.
    """

    def save_artifact(
        self, slug: str, phase: str, content: str, namespace: str = "features"
    ) -> str | None:
        """Salva artefato. Retorna URL ou None em caso de falha."""
        ...

    def get_artifact(
        self, slug: str, phase: str, namespace: str = "features"
    ) -> str | None:
        """Lê artefato. Retorna conteúdo ou None se não encontrado."""
        ...

    def list_artifacts(self, slug: str, namespace: str = "features") -> list[str]:
        """Lista fases presentes no namespace para o slug (nomes uppercase sem .md)."""
        ...

    def delete_artifact(
        self, slug: str, phase: str, namespace: str = "features"
    ) -> None:
        """Remove artefato. Usado em approve (move drafts→features) e cleanup."""
        ...
