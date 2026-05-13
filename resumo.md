# Resumo — deepagents-sdd-mvp

## Objetivo Estratégico

Este MVP permite criar artefatos SDD em **5 steps sequenciais** usando o framework **deepagents** com acesso real ao repositório via **Daytona sandbox**. O objetivo final é **substituir o motor de geração de artefatos do `be-champion-ai`** — quando validado, o pipeline deepagents + Daytona substitui o motor atual em produção, adicionando a capacidade de modo brownfield (o agente explora o código real antes de gerar cada artefato).

## Pontos Chave da Conversa

### Arquitetura Central
- **CompositeBackend**: `default=FilesystemBackend(.specs/)` para drafts + `routes={"/repo/": DaytonaBackend}` para o repositório. O agente usa `ls /repo/`, `grep`, `read_file` antes de gerar.
- **`config.configurable.slug`**: o slug flui do frontend → LangGraph config → `_resolve_backend(slug)` → backend correto por invocação (não singleton fixo).
- **LangGraph já persiste threads** via `.langgraph_api/*.pckl`. O SQLite resolve problema diferente: reconnectar slug→sandbox_id após restart.

### Daytona Lifecycle (3 camadas de proteção contra cold start)
1. `auto_stop_interval=0` na criação — desabilita parada automática dos 15min
2. `_reload_from_db()` ao subir o backend — reconnecta via `client.get(sandbox_id)`, tenta `client.start()` se parado, marca mortos
3. `GET /sandboxes/{slug}` com live `sandbox.refresh_data()` + polling frontend a 60s

### SQLite como Sinal de Migração
Tabelas `sandboxes` + `settings`. Toda lógica SQL isolada em `db.py` — trocar `sqlite3` por `psycopg2` não toca outros módulos.

### BlobStorage Port-Adapter (espelho do champion-ai)
- `BlobStorage` Protocol → `NoopBlobAdapter` (filesystem, URL fake) → `AzureBlobAdapter` (opcional)
- Factory decide via `AZURE_STORAGE_CONNECTION_STRING`. Para ir a produção: só definir a env var.
- Drafts ficam no filesystem (temporários). Artefatos aprovados passam pelo storage.

### Frontend — Tela Única
- `SettingsSidebar` (PAT global) + `SandboxCard` inline + `TerminalPanel` colapsável (`▶`/`▼`) + 5 fases
- Polling de saúde com feature flag `VITE_SANDBOX_POLL_ENABLED`
- SSE error surfacing com banner vermelho
