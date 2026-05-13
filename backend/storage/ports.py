from typing import Protocol, runtime_checkable


@runtime_checkable
class BlobStorage(Protocol):
    """Port: contrato de armazenamento de artefatos.

    Implementações:
      - NoopBlobAdapter  → filesystem local (dev/MVP sem Azure)
      - AzureBlobAdapter → Azure Blob Storage (produção)
    """

    def save_artifact(self, slug: str, phase: str, content: str) -> str | None:
        """Salva artefato aprovado. Retorna URL ou None em caso de falha."""
        ...

    def get_artifact(self, slug: str, phase: str) -> str | None:
        """Lê artefato aprovado. Retorna conteúdo ou None se não encontrado."""
        ...

    def list_artifacts(self, slug: str) -> list[str]:
        """Lista fases aprovadas para o slug (nomes sem extensão, uppercase)."""
        ...

    def delete_artifact(self, slug: str, phase: str) -> None:
        """Remove artefato aprovado (usado em testes e cleanup)."""
        ...
