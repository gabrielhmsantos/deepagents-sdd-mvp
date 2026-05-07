import os
from pathlib import Path

from deepagents import create_deep_agent
from deepagents.backends.filesystem import FilesystemBackend

MODEL = os.environ.get("MODEL", "openrouter:minimax/minimax-m2.7")
PROJECT_ROOT = Path(__file__).parents[2]   # champion-ai-deepagents/
PROMPTS_DIR = PROJECT_ROOT / "prompts"

# Instrução adicionada ao final de cada system prompt para que o agente
# salve o artefato gerado diretamente no filesystem via write_file tool.
_SAVE_INSTRUCTION = """

---

## INSTRUÇÃO DE SAÍDA

Ao concluir a geração do artefato, use a ferramenta `write_file` para salvar o conteúdo no caminho exato indicado em `[SALVAR EM]` da mensagem do usuário.

Regras obrigatórias:
- Use o caminho **exatamente como fornecido** em `[SALVAR EM]` (não converta para absoluto).
- O conteúdo do arquivo deve ser o artefato markdown completo, sem preâmbulo nem comentários extras.
- Antes de chamar `write_file`, exiba o artefato completo na sua resposta de texto para que o usuário acompanhe a geração em tempo real.
"""


def make_agent(prompt_filename: str):
    base_prompt = (PROMPTS_DIR / prompt_filename).read_text(encoding="utf-8")
    return create_deep_agent(
        model=MODEL,
        system_prompt=base_prompt + _SAVE_INSTRUCTION,
        backend=FilesystemBackend(root_dir=str(PROJECT_ROOT), virtual_mode=False),
        skills=["backend/skills"],  # PROJECT_ROOT/backend/skills/tlc-spec-driven/
    )
