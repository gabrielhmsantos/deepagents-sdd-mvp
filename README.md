# Champion AI — SDD Studio

Geração de artefatos SDD (Software Design Documents) em pt-BR via agentes `deepagents` com UI de revisão.

## Como funciona

5 agentes independentes — um por artefato — expostos via LangGraph runtime:

| Artefato | Agente | Artefato gerado |
|---|---|---|
| Constituição | `constituicao` | Visão, princípios, critérios, escopo |
| PRD | `prd` | Requisitos BR-XXX / NFR-XXX, métricas |
| Especificação | `especificacao` | User stories P1/P2/P3, FR-XXX, rastreabilidade |
| Plano | `plano` | Arquitetura, decisões técnicas, estrutura de arquivos |
| Tarefas | `tarefas` | Tasks atômicas com gates e Conventional Commits |

Modelo padrão: `openrouter:minimax/minimax-m2.7` (configurável via `.env`).

## Setup

### Backend

```bash
cd backend
cp .env.example .env
# editar .env: OPENROUTER_API_KEY=sk-or-...

# Python 3.11+
pip install -e .   # ou: uv sync

langgraph dev --n-jobs-per-worker 5
# Servidor em http://localhost:2024
```

Verificar: `curl http://localhost:2024/assistants` → deve listar 5 graphs.

### Frontend

```bash
cd frontend
npm install
npm run dev
# UI em http://localhost:5173
```

## Fluxo de uso

1. Sidebar: selecionar o artefato desejado (Constituição → PRD → Especificação → Plano → Tarefas).
2. Preencher o slug do épico e a descrição.
3. Opcionalmente: anexar documentos base (contrato PDF, RFP, briefing).
4. Clicar **Gerar** — o artefato aparece em streaming; o draft é salvo automaticamente em `.specs/drafts/`.
5. Revisar o markdown. Se necessário: **Solicitar alterações** (EDIT mode preserva IDs rastreáveis).
6. **Aprovar** — move o draft para `.specs/features/<slug>/`.
7. Avançar para o próximo artefato, marcando "Incluir artefatos anteriores aprovados como contexto".

## Estrutura de pastas

```
backend/
  agents/          # 5 entrypoints + fábrica compartilhada
  api.py           # FastAPI: drafts / approve / artifacts / uploads
  uploads.py       # Extração de texto PDF / DOCX / TXT / MD
  langgraph.json   # Registro dos 5 graphs
  pyproject.toml

frontend/
  src/
    components/    # ArtifactPanel, ArtifactSidebar, UploadDropzone, etc.
    hooks/         # useArtifactAgent (wrapper de useStream por phase)
    lib/           # api.ts, prompts.ts, types.ts

prompts/           # System prompts READ-ONLY (um por artefato)
.specs/            # Gerado
  drafts/          # Work-in-progress
  features/        # Aprovados (fonte da verdade)
  uploads/         # Documentos base enviados
```

## Variáveis de ambiente

| Variável | Descrição | Default |
|---|---|---|
| `OPENROUTER_API_KEY` | Chave da API OpenRouter | — |
| `MODEL` | Modelo via `init_chat_model` | `openrouter:minimax/minimax-m2.7` |
| `MODEL_CONTEXT_WINDOW` | Janela de contexto (tokens) para aviso na UI | `200000` |
