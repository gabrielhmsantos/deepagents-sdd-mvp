"""NoopBlobAdapter — implementação fake para desenvolvimento local.

Persiste artefatos no filesystem local com layout `<base_dir>/<namespace>/<slug>/<PHASE>.md`
e retorna URLs fictícias no formato que a produção retornaria do Azure.
Não requer credenciais nem conexão externa.

Trocar por AzureBlobAdapter em produção sem alterar nenhum código de negócio.
"""
from pathlib import Path


class NoopBlobAdapter:
    FAKE_BASE_URL = "https://fake-storage.local/champion-ai"

    def __init__(self, base_dir: Path) -> None:
        # base_dir = .specs/ (raiz local que espelha o root do container blob).
        # Subpastas drafts/ e features/ vivem aqui sob o nome do namespace.
        self._base = base_dir

    def _path(self, slug: str, phase: str, namespace: str) -> Path:
        return self._base / namespace / slug / f"{phase.upper()}.md"

    def save_artifact(
        self, slug: str, phase: str, content: str, namespace: str = "features"
    ) -> str | None:
        p = self._path(slug, phase, namespace)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")
        return f"{self.FAKE_BASE_URL}/{namespace}/{slug}/{phase.upper()}.md"

    def get_artifact(
        self, slug: str, phase: str, namespace: str = "features"
    ) -> str | None:
        p = self._path(slug, phase, namespace)
        return p.read_text(encoding="utf-8") if p.exists() else None

    def list_artifacts(self, slug: str, namespace: str = "features") -> list[str]:
        folder = self._base / namespace / slug
        if not folder.exists():
            return []
        return sorted(p.stem for p in folder.glob("*.md"))

    def delete_artifact(
        self, slug: str, phase: str, namespace: str = "features"
    ) -> None:
        p = self._path(slug, phase, namespace)
        if p.exists():
            p.unlink()
            # Remove pasta do slug se ficou vazia. rmdir falha (OSError) se ainda
            # houver outros arquivos — ok, silenciar.
            try:
                p.parent.rmdir()
            except OSError:
                pass
