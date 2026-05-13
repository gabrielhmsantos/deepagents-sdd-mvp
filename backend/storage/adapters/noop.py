"""NoopBlobAdapter — implementação fake para desenvolvimento local.

Persiste artefatos no filesystem local (mesma estrutura de diretórios do MVP)
e retorna URLs fictícias no formato que a produção retornaria do Azure.
Não requer credenciais nem conexão externa.

Trocar por AzureBlobAdapter em produção sem alterar nenhum código de negócio.
"""
from pathlib import Path


class NoopBlobAdapter:
    FAKE_BASE_URL = "https://fake-storage.local/champion-ai"

    def __init__(self, features_dir: Path) -> None:
        self._features = features_dir

    def _path(self, slug: str, phase: str) -> Path:
        return self._features / slug / f"{phase.upper()}.md"

    def save_artifact(self, slug: str, phase: str, content: str) -> str | None:
        p = self._path(slug, phase)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")
        return f"{self.FAKE_BASE_URL}/features/{slug}/{phase.upper()}.md"

    def get_artifact(self, slug: str, phase: str) -> str | None:
        p = self._path(slug, phase)
        return p.read_text(encoding="utf-8") if p.exists() else None

    def list_artifacts(self, slug: str) -> list[str]:
        folder = self._features / slug
        if not folder.exists():
            return []
        return sorted(p.stem for p in folder.glob("*.md"))

    def delete_artifact(self, slug: str, phase: str) -> None:
        p = self._path(slug, phase)
        if p.exists():
            p.unlink()
