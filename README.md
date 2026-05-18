# Champion AI — SDD Studio

Geração de artefatos SDD (Software Design Documents) em pt-BR via agentes `deepagents` com acesso ao repositório real do cliente via **Daytona sandbox**.

## Como funciona

5 agentes independentes — um por artefato — expostos via LangGraph runtime. Cada agente é um `StateGraph` customizado com validação pós-geração e retry automático (até 2 tentativas) caso o arquivo não seja salvo.

| Artefato | Agente | Conteúdo |
|---|---|---|
| Constituição | `constituicao` | Visão, princípios, critérios, escopo |
| PRD | `prd` | Requisitos BR-XXX / NFR-XXX, métricas |
| Especificação | `especificacao` | User stories P1/P2/P3, FR-XXX, rastreabilidade |
| Plano | `plano` | Arquitetura, decisões técnicas, estrutura de arquivos |
| Tarefas | `tarefas` | Tasks atômicas com gates e Conventional Commits |

Cada fase é sequencial. O agente explora o repositório clonado em `/home/daytona/repo/` e salva artefatos em `/home/daytona/specs/{slug}/` dentro do sandbox Daytona. Artefatos aprovados são snapshoteados no blob storage (filesystem local ou Azure).

## Setup

### Backend

```bash
cd backend
cp .env.example .env
# editar .env com DAYTONA_API_KEY, chave LLM e demais credenciais

uv sync
uv run langgraph dev --port 8000 --no-browser
# Servidor unificado em http://localhost:8000
# - LangGraph runtime: POST /threads, /threads/{id}/runs/stream
# - FastAPI custom:
#     /projects, /admin/projects   (CRUD de projetos)
#     /ensure/{slug}, /cancel/{slug} (lifecycle de sandbox)
#     /drafts, /approve, /artifacts  (artefatos)
#     /github/repos                  (proxy autenticado à GitHub API)
#     /sandboxes/{slug}              (GET status, POST exec — power-user)
#     /settings/github-pat           (PAT global)
#     /uploads                       (documentos base)
```

Verificar: `curl http://localhost:8000/threads -X POST -H "Content-Type: application/json" -d "{}"` → deve retornar `{"thread_id": "..."}`.

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

## Fluxo de uso

1. **(Setup uma vez)** Abrir **⚙ Configurações** no rodapé do sidebar esquerdo, ir em **Integrações**, salvar o **GitHub PAT** (escopo `repo` ou fine-grained `Contents: Read-only`).
2. Clicar **+ Novo projeto** no sidebar — abre o form unificado.
3. Preencher: **slug**, **SSG ID** (1-5 dígitos, cosmético), **ideia** (descrição), e selecionar **repositório** no dropdown (alimentado pelo PAT). **Branch** auto-fetched do repo (editável).
4. Clicar **Criar projeto** — backend persiste em `projects` + cria sandbox Daytona (eager, com `git clone`). Form some, dá lugar ao **ProjectHeader** compacto.
5. Opcionalmente: anexar **documentos base** (PDF, DOCX, TXT, MD).
6. Clicar **Gerar** em cada `PhaseSection` (sequencial). Cada Gerar faz preflight via `POST /ensure/{slug}` (idempotente, recupera de auto-stop em estado C ou delete externo D).
7. Agente acessa `/home/daytona/repo/` e salva o draft em `/home/daytona/specs/{slug}/{PHASE}.md`. Predecessores são lidos via `read_file` tool (sem injeção no system prompt).
8. Revisar o artefato em markdown. Se necessário: **Solicitar alterações** (preserva IDs BR-XXX, FR-XXX via `edit_file`).
9. **Aprovar** — move o draft do namespace `drafts/` → `features/` no blob. Avança pra próxima fase.
10. Ao aprovar **TAREFAS**, o pipeline encerra: snapshot do repo gera `REPO_TREE`, sandbox é deletada, ZIP fica disponível.
11. **Admin** (sidebar → Configurações → aba **Admin: Projetos**): tabela project-centric com search, filter por status, e ações por linha (**Cancelar sandbox** soft, **Deletar projeto** ríspido).

**Greenfield** (sem repositório GitHub): pular o repo picker no submit → confirma modal de warning → projeto criado sem clone. Artefatos não terão referência a código existente.

## Variáveis de ambiente

| Variável | Descrição | Obrigatória |
|---|---|---|
| `DAYTONA_API_KEY` | Chave Daytona (obter em app.daytona.io) | Sim (modo sandbox) |
| `DAYTONA_SERVER_URL` | URL do servidor Daytona (só self-hosted) | Não |
| `DAYTONA_AUTO_STOP_INTERVAL_MIN` | Minutos de ociosidade antes do auto-stop (`0` = nunca) | Não (default: `5`) |
| `DAYTONA_STATE_CACHE_TTL_SECS` | TTL do cache de estado do sandbox (evita HTTP roundtrip em /ensure repetidos) | Não (default: `60`) |
| `GITHUB_REPOS_CACHE_TTL_SECS` | TTL do cache de `GET /api/github/repos` (reduz chamadas à GitHub API) | Não (default: `300`) |
| `ANTHROPIC_API_KEY` | Chave Anthropic | Se `MODEL=anthropic:*` |
| `OPENROUTER_API_KEY` | Chave OpenRouter | Se `MODEL=openrouter:*` |
| `MODEL` | Modelo LLM (ver tabela acima) | Não (default: `openrouter:minimax/minimax-m2.7`) |
| `MODEL_CONTEXT_WINDOW` | Janela de contexto em tokens | Não (default: `200000`) |
| `AZURE_STORAGE_CONNECTION_STRING` | Conexão Azure Blob Storage; vazio → NoopBlobAdapter (filesystem local) | Não |
| `LANGSMITH_TRACING` | Habilitar tracing LangSmith | Não |
| `LANGSMITH_API_KEY` | Chave LangSmith | Se tracing habilitado |

## Estrutura de pastas

```
backend/
  agents/          # 5 entrypoints + _factory.py (StateGraph com retry + snapshot pós-fase)
  api.py           # FastAPI: /projects, /admin/projects, /github/repos, /ensure, /cancel, /drafts, /approve, /artifacts, /settings, /uploads
  daytona.py       # _DaytonaManager: lifecycle (A/B/C/D) + state/hydrate cache + DaytonaBackend
  sandboxes.py     # GET /sandboxes/{slug} (status polling) + POST /sandboxes/{slug}/exec (power-user)
  db.py            # SQLite: projects, sandboxes (lifecycle), user_github_settings, github_project_config, global_skills, user_skills_config, users (mock single-row)
  storage/         # Port-Adapter: NoopBlobAdapter (local) / AzureBlobAdapter (prod), namespaces drafts/+features/
  uploads.py       # Extração de texto PDF / DOCX / TXT / MD
  langgraph.json   # Registro dos 5 graphs + http.app

frontend/
  src/
    components/    # PhaseSection, SandboxCard, TerminalPanel, SettingsSidebar, etc.
    hooks/         # useArtifactAgent (SSE streaming + error handling)
    lib/           # api.ts, prompts.ts, types.ts

prompts/           # System prompts (um por artefato)

.specs/            # Gerado em runtime (blob storage local)
  features/        # Artefatos aprovados — fonte da verdade
  drafts/          # Work-in-progress (snapshot do sandbox após cada geração)
  uploads/         # Documentos base enviados pelo usuário
```

## Testes E2E (requer Daytona real)

Os testes unitários e de integração da API rodam sem Daytona. O script abaixo verifica o lifecycle completo de sandbox contra o serviço real.

### Pré-requisitos

- Backend rodando (`uv run langgraph dev --port 8000 --no-browser`)
- `DAYTONA_API_KEY` configurado no `.env`

### Rodar

```bash
cd backend

# Modo brownfield (com clone de repositório)
uv run python e2e_check.py --slug meu-slug --repo-url https://github.com/org/repo

# Modo greenfield (sandbox sem clone)
uv run python e2e_check.py --slug meu-slug --no-repo

# Branch específica
uv run python e2e_check.py --slug meu-slug --repo-url https://github.com/org/repo --branch develop
```

O script verifica sequencialmente:

| # | Check | O que valida |
|---|---|---|
| 1 | Estado A | Cria sandbox (15-30s) + retorna sandbox_id |
| 2 | Estado B | Segunda chamada retorna em <2s, mesmo sandbox_id (idempotência) |
| 3 | Status | `GET /sandboxes/{slug}` retorna status `started` |
| 4 | Hidratação | Instrução para verificar `/home/daytona/specs/{slug}/` no sandbox |
| 5 | Cancel | `POST /cancel/{slug}` + confirma deleção (opcional, interativo) |
| 6 | Estado A pós-cancel | Recria com novo sandbox_id |

**Estados C e D** requerem interação manual (descritos no output do script):
- **C (stopped)**: aguardar `DAYTONA_AUTO_STOP_INTERVAL_MIN` minutos → chamar `/ensure` → deve dar start em ~3-5s
- **D (delete externo)**: deletar no painel Daytona → chamar `/ensure` → deve recriar em ~15-30s
