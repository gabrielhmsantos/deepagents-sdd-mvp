import { useCallback, useRef, useState } from "react";
import type { Phase } from "../lib/types";

const API = "/api";

interface AgentState {
  isLoading: boolean;
}

export function useArtifactAgent(phase: Phase) {
  const [state, setState] = useState<AgentState>({ isLoading: false });
  const abortRef = useRef<AbortController | null>(null);

  const submit = useCallback(
    async (input: { messages: Array<{ role: string; content: string }> }) => {
      abortRef.current?.abort();
      const abort = new AbortController();
      abortRef.current = abort;

      setState({ isLoading: true });

      try {
        // Create a fresh thread for each generation
        const threadResp = await fetch(`${API}/threads`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
          signal: abort.signal,
        });
        const threadData = await threadResp.json() as { thread_id: string };
        const threadId = threadData.thread_id;

        // Stream the run via SSE
        const resp = await fetch(`${API}/threads/${threadId}/runs/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify({
            assistant_id: phase,
            input: { messages: input.messages },
            stream_mode: ["messages"],
          }),
          signal: abort.signal,
        });

        const reader = resp.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let eventType = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (line.startsWith("event: ")) {
              eventType = line.slice(7).trim();
            } else if (line.startsWith("data: ")) {
              if (eventType === "messages/partial") {
                try {
                  // content ignorado — fonte autoritativa é o arquivo salvo no disco
                } catch {
                  // ignore malformed event
                }
              }
            } else if (line === "") {
              eventType = "";
            }
          }
        }
      } catch (e: unknown) {
        if ((e as Error).name !== "AbortError") console.error("Stream error:", e);
      } finally {
        setState((s) => ({ ...s, isLoading: false }));
      }
    },
    [phase]
  );

  return { isLoading: state.isLoading, submit };
}
