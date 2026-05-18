import { useCallback, useEffect, useRef, useState } from "react";
import { ensureSandbox } from "../lib/api";
import type { Phase } from "../lib/types";

const API = "/api";
// Stream sem nenhum evento (data: ...) por mais tempo que isso = considera travado.
// Não é deadline absoluto da geração, é deadline de SILÊNCIO do servidor.
const STREAM_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

export interface ClarificationQuestion {
  question: string;
  type: "radio" | "checkbox" | "text";
  options?: string[];
}

interface AgentState {
  isLoading: boolean;
  isError: boolean;
  errorMessage: string;
  wasCanceled: boolean;
  clarificationQuestions: ClarificationQuestion[] | null;
}

// Outcome explícito de cada submit. Permite distinguir "stream fechou
// naturalmente" (consumidor deve ler o draft) de "fetch abortado por
// StrictMode / Cancel / unmount" (consumidor deve ignorar).
export type SubmitResult = "completed" | "aborted" | "error";

// Best-effort fire-and-forget: pede ao langgraph dev pra encerrar o run.
// Sem isso, abort no front só fecha o SSE, mas o worker do backend continua
// rodando o agente até o fim (run zombie).
//
// Endpoint correto: POST /threads/{thread_id}/runs/{run_id}/cancel — confirmado
// em .venv/.../langgraph_api/api/runs.py:985. Versão anterior usava
// /threads/{thread_id}/cancel que devolve 404 (rota não existe).
function cancelBackendRun(threadId: string | null, runId: string | null) {
  if (!threadId || !runId) return;
  fetch(`${API}/threads/${threadId}/runs/${runId}/cancel`, { method: "POST" })
    .catch(() => {});
}

export function useArtifactAgent(phase: Phase, slug: string) {
  const [state, setState] = useState<AgentState>({
    isLoading: false, isError: false, errorMessage: "", wasCanceled: false,
    clarificationQuestions: null,
  });
  const abortRef = useRef<AbortController | null>(null);
  // True quando o usuário clicou Cancelar. Usado no catch pra distinguir
  // abort intencional (mostra feedback + cancela no backend) de abort por
  // cleanup do StrictMode em dev (não toca em state).
  const userCanceledRef = useRef(false);
  // thread_id como state (não só ref) para que o useEffect de polling
  // re-execute quando o thread é criado — ref não dispara re-render.
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const threadIdRef = useRef<string | null>(null);
  // True enquanto o ClarificationDialog está aberto — pausa o watchdog de silêncio.
  const clarificationOpenRef = useRef(false);

  // Aborta qualquer run em andamento ao desmontar.
  useEffect(() => () => abortRef.current?.abort(), []);

  // Poll GET /clarifications/{thread_id} a cada 10s enquanto isLoading.
  // Depende de activeThreadId (state) para re-executar quando o thread é criado,
  // evitando a race condition onde isLoading=true mas threadId ainda era null.
  useEffect(() => {
    if (!state.isLoading || !activeThreadId) return;
    const tid = activeThreadId;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API}/clarifications/${tid}`);
        if (!res.ok) return;
        const data = await res.json() as { status: string; questions?: ClarificationQuestion[] };
        if (data.status === "pending" && data.questions) {
          clarificationOpenRef.current = true;
          setState((s) => ({ ...s, clarificationQuestions: data.questions! }));
        }
      } catch { /* network blip — ignora */ }
    }, 10_000);
    return () => clearInterval(interval);
  }, [state.isLoading, activeThreadId]);

  const cancel = useCallback(() => {
    userCanceledRef.current = true;
    abortRef.current?.abort();
  }, []);

  const submitAnswers = useCallback(async (answers: (string | string[])[]) => {
    const tid = threadIdRef.current;
    if (!tid) return;
    await fetch(`${API}/clarifications/${tid}/answers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers }),
    }).catch(() => {});
    clarificationOpenRef.current = false;
    setState((s) => ({ ...s, clarificationQuestions: null }));
  }, []);

  const submit = useCallback(
    async (input: { messages: Array<{ role: string; content: string }> }): Promise<SubmitResult> => {
      abortRef.current?.abort();
      const abort = new AbortController();
      abortRef.current = abort;
      userCanceledRef.current = false;

      setState({ isLoading: true, isError: false, errorMessage: "", wasCanceled: false, clarificationQuestions: null });
      setActiveThreadId(null); // reseta para o novo run

      // Watchdog: aborta se o stream ficar silencioso por muito tempo.
      // Quando o ClarificationDialog está aberto, re-arm em vez de disparar.
      let idleTimer: ReturnType<typeof setTimeout> | null = null;
      let idleTripped = false;
      const armWatchdog = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          if (clarificationOpenRef.current) {
            armWatchdog(); // dialog aberto: prorroga o watchdog
            return;
          }
          idleTripped = true;
          abort.abort();
        }, STREAM_IDLE_TIMEOUT_MS);
      };

      let result: SubmitResult = "error";
      let wasCleanupAbort = false;
      // Promovidos pro escopo do submit pra ficar acessíveis no catch.
      // threadId vem do POST /threads; runId vem do primeiro event:metadata
      // do SSE. Ambos são obrigatórios pro endpoint de cancel.
      let threadId: string | null = null;
      let runId: string | null = null;

      try {
        // Preflight: garante sandbox vivo antes do stream. Recupera transparentemente
        // de auto-stop (estado C) ou delete externo (estado D). Em estado B (cache
        // hit no manager), retorna <100ms. Body vazio: backend lê repo_url/branch
        // de `projects` (criado via POST /api/projects pelo ProjectForm).
        await ensureSandbox(slug);

        const threadResp = await fetch(`${API}/threads`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
          signal: abort.signal,
        });
        if (!threadResp.ok) {
          throw new Error(
            `Falha ao criar thread (${threadResp.status}). ` +
              "Verifique se o backend foi iniciado com `langgraph dev --port 8000` " +
              "(não `uvicorn api:app`) — as rotas /threads vêm do LangGraph CLI."
          );
        }
        const threadData = await threadResp.json() as { thread_id?: string };
        threadId = threadData.thread_id ?? null;
        threadIdRef.current = threadId;
        setActiveThreadId(threadId); // dispara re-execução do useEffect de polling
        if (!threadId) {
          throw new Error("Resposta de /threads sem thread_id.");
        }

        const resp = await fetch(`${API}/threads/${threadId}/runs/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify({
            assistant_id: phase,
            input: { messages: input.messages },
            stream_mode: ["messages"],
            config: { configurable: { slug } },
          }),
          signal: abort.signal,
        });

        const reader = resp.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let eventType = "";
        armWatchdog();

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            // Stream encerrou naturalmente (server fechou o SSE).
            console.log("[SSE] stream closed naturally");
            result = "completed";
            break;
          }
          armWatchdog();
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (line.startsWith("event: ")) {
              eventType = line.slice(7).trim();
              console.log("[SSE event]", eventType);
            } else if (line.startsWith("data: ")) {
              console.log("[SSE data]", eventType, line.slice(6, 240));
              if (eventType === "metadata" && !runId) {
                // langgraph dev emite metadata como primeiro evento, com run_id.
                // Captura uma vez (early return via && !runId) pra alimentar o cancel.
                try {
                  const meta = JSON.parse(line.slice(6)) as { run_id?: string };
                  if (meta.run_id) runId = meta.run_id;
                } catch { /* ignore */ }
              } else if (eventType === "error") {
                try {
                  const msg = (JSON.parse(line.slice(6)) as { message?: string })?.message ?? "Erro no agente.";
                  setState((s) => ({ ...s, isError: true, errorMessage: msg }));
                } catch {
                  setState((s) => ({ ...s, isError: true, errorMessage: "Erro no agente." }));
                }
              }
            } else if (line === "") {
              eventType = "";
            }
          }
        }
      } catch (e: unknown) {
        const err = e as Error;
        if (err.name === "AbortError") {
          if (idleTripped) {
            // Watchdog: 5 min sem evento → mata o backend run e mostra erro.
            cancelBackendRun(threadId, runId);
            setState((s) => ({
              ...s,
              isError: true,
              errorMessage:
                `Stream silencioso por mais de ${Math.round(STREAM_IDLE_TIMEOUT_MS / 60000)} min — ` +
                "o backend pode estar travado (provável tool call sem resposta). " +
                "Veja o log do servidor para a última chamada antes do silêncio.",
            }));
            result = "error";
          } else if (userCanceledRef.current) {
            // Cancelamento explícito do usuário: mata o backend run e flagga UI.
            cancelBackendRun(threadId, runId);
            setState((s) => ({ ...s, wasCanceled: true }));
            result = "aborted";
          } else {
            // StrictMode cleanup ou unmount real. NÃO tocar em state nem cancelar
            // o backend: a 2ª passada do submit em dev usa uma thread NOVA, e
            // mexer em state aqui faria isLoading virar false durante o ciclo
            // mount→cleanup→remount, escondendo o status "⏳ Gerando".
            wasCleanupAbort = true;
            result = "aborted";
          }
        } else {
          setState((s) => ({ ...s, isError: true, errorMessage: String(e) }));
          result = "error";
        }
      } finally {
        if (idleTimer) clearTimeout(idleTimer);
        if (!wasCleanupAbort) {
          setState((s) => ({ ...s, isLoading: false }));
        }
      }

      return result;
    },
    [phase, slug]
  );

  return {
    isLoading: state.isLoading,
    isError: state.isError,
    errorMessage: state.errorMessage,
    wasCanceled: state.wasCanceled,
    clarificationQuestions: state.clarificationQuestions,
    submit,
    cancel,
    submitAnswers,
  };
}
