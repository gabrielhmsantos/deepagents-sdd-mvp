# Champion AI — SDD Studio

Geração de artefatos SDD (Software Design Documents) em pt-BR via agentes `deepagents` com UI de revisão e aprovação.

## Como funciona

5 agentes independentes — um por artefato — expostos via LangGraph runtime. Cada agente é um `StateGraph` customizado com validação pós-geração e retry automático (até 2 tentativas) caso o arquivo não seja salvo.

| Artefato | Agente | Conteúdo |
|---|---|---|
| Constituição | `constituicao` | Visão, princípios, critérios, escopo |
| PRD | `prd` | Requisitos BR-XXX / NFR-XXX, métricas |
| Especificação | `especificacao` | User stories P1/P2/P3, FR-XXX, rastreabilidade |
| Plano | `plano` | Arquitetura, decisões técnicas, estrutura de arquivos |
| Tarefas | `tarefas` | Tasks atômicas com gates e Conventional Commits |

## Setup

### Backend

```bash
cd backend
cp .env.example .env
# editar .env com as credenciais do provedor escolhido

# Python 3.11+
uv sync   # ou: pip install -e .

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

## Modelos suportados

Configurável via `MODEL` no `.env`. Qualquer modelo compatível com `init_chat_model` do LangChain:

| Provedor | Exemplo de MODEL |
|---|---|
| **Anthropic** (recomendado) | `anthropic:claude-sonnet-4-6` |
| Anthropic | `anthropic:claude-opus-4-7` |
| Anthropic | `anthropic:claude-haiku-4-5` |
| OpenRouter | `openrouter:minimax/minimax-m2.7` |
| OpenRouter | `openrouter:openai/gpt-4o` |

Para Anthropic, adicionar `ANTHROPIC_API_KEY` no `.env`.  
Para OpenRouter, adicionar `OPENROUTER_API_KEY` no `.env`.

## Fluxo de uso

1. Preencher o **slug do épico** e a **descrição** do produto/feature.
2. Opcionalmente: anexar documentos base (PDF, DOCX, TXT, MD).
3. Clicar **Gerar** — o agente processa e salva o draft em `.specs/drafts/`.
4. Após a geração, revisar o artefato em markdown.
5. Se necessário: **Solicitar alterações** (preserva IDs BR-XXX, FR-XXX via `edit_file`).
6. **Aprovar** — move o draft para `.specs/features/<slug>/`.
7. Avançar para o próximo artefato (cada fase recebe os anteriores aprovados como contexto).

## Estrutura de pastas

```
backend/
  agents/          # 5 entrypoints + _factory.py (StateGraph com retry)
  api.py           # FastAPI: drafts / approve / artifacts / uploads
  uploads.py       # Extração de texto PDF / DOCX / TXT / MD
  langgraph.json   # Registro dos 5 graphs
  pyproject.toml

frontend/
  src/
    components/    # PhaseSection, UploadDropzone, MarkdownPreview, etc.
    hooks/         # useArtifactAgent (SSE streaming)
    lib/           # api.ts, prompts.ts, types.ts

prompts/           # System prompts (um por artefato, somente leitura)

.specs/            # Gerado em runtime
  drafts/          # Work-in-progress (write pelo agente)
  features/        # Aprovados — fonte da verdade
  uploads/         # Documentos base enviados pelo usuário
```

## Variáveis de ambiente

| Variável | Descrição | Obrigatória |
|---|---|---|
| `ANTHROPIC_API_KEY` | Chave Anthropic | Se `MODEL=anthropic:*` |
| `OPENROUTER_API_KEY` | Chave OpenRouter | Se `MODEL=openrouter:*` |
| `MODEL` | Modelo (ver tabela acima) | Não (default: `openrouter:minimax/minimax-m2.7`) |
| `MODEL_CONTEXT_WINDOW` | Janela de contexto em tokens | Não (default: `200000`) |
| `LANGSMITH_TRACING` | Habilitar tracing LangSmith | Não |
| `LANGSMITH_API_KEY` | Chave LangSmith | Se tracing habilitado |
| `LANGSMITH_PROJECT` | Nome do projeto no LangSmith | Não |

## Roadmap

Ver [ROADMAP-SANDBOX.md](ROADMAP-SANDBOX.md) — modo brownfield com clone de repositório existente para o agente de Plano explorar o codebase real.
