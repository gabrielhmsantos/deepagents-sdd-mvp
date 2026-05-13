# Champion AI — Backend

Servidor único que combina FastAPI (rotas `/drafts`, `/artifacts`, `/sandboxes`, `/uploads`, `/settings`) com o servidor da LangGraph (rotas `/threads`, `/runs/stream` + os grafos declarados em `langgraph.json`).

## Rodar em desenvolvimento

```powershell
uv run langgraph dev --port 8000 --no-browser
```

> **Não use `uvicorn api:app` direto.** Esse comando sobe apenas a metade FastAPI; as rotas LangGraph (`/threads`, `/runs/stream`) ficam ausentes e o front quebra com 404 ao chamar `POST /api/threads`.

O `frontend/vite.config.ts` faz proxy `/api → http://localhost:8000`.

## Healthcheck rápido

```powershell
curl http://localhost:8000/openapi.json   # confirma FastAPI app montado (title "Champion AI")
curl -X POST http://localhost:8000/threads -H "Content-Type: application/json" -d "{}"   # confirma LangGraph montado (retorna {thread_id: ...})
```
