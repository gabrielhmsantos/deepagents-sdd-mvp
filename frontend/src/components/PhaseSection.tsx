import { useCallback, useEffect, useState } from "react";
import { approve, readArtifact, readDraft, readExtracted } from "../lib/api";
import { buildEditInput, buildInitialInput } from "../lib/prompts";
import { PHASE_DESCRIPTIONS, PHASE_LABELS } from "../lib/types";
import type { Phase, UploadedFile } from "../lib/types";
import { useArtifactAgent } from "../hooks/useArtifactAgent";
import { EditModeDialog } from "./EditModeDialog";
import { MarkdownPreview } from "./MarkdownPreview";

interface Props {
  phase: Phase;
  slug: string;
  description: string;
  files: UploadedFile[];
  isApproved: boolean;
  isActive: boolean;
  isLocked: boolean;
  onApproved: () => void;
}

// ── componente interno de streaming ─────────────────────────────────────────
interface StreamProps {
  phase: Phase;
  slug: string;
  initialInput: string;
  onApproved: (content: string) => void;
}

function PhaseStream({ phase, slug, initialInput, onApproved }: StreamProps) {
  const { isLoading, isError, errorMessage, wasCanceled, submit, cancel } = useArtifactAgent(phase, slug);
  const [preview, setPreview] = useState("");
  const [done, setDone] = useState(false);
  // Phantom completion: stream fechou mas readDraft devolveu null. Significa
  // que o agente terminou sem chamar write_file (MAX_RETRIES esgotado, ou path
  // errado em [SALVAR EM]). Sem este estado, "done=true" liberava o botão
  // Aprovar e o clique disparava 404 silencioso em /approve.
  const [phantom, setPhantom] = useState(false);
  const [showEdit, setShowEdit] = useState(false);

  // Carrega o draft do disco — só chamado quando submit retorna "completed"
  // (server fechou o SSE naturalmente). NÃO chamar em "aborted": em StrictMode
  // dev o submit roda 2x e a 1ª passada é abortada pelo cleanup; se "done"
  // disparasse na transição isLoading=true→false do submit abortado, a UI
  // mostraria "Aprovar"/preview vazio enquanto o agente ainda gera.
  //
  // Se readDraft retornar null/erro, vira phantom completion em vez de done.
  const handleCompleted = useCallback(() => {
    readDraft(slug, phase.toUpperCase())
      .then((saved) => {
        if (saved) {
          setPreview(saved);
          setDone(true);
          setPhantom(false);
        } else {
          setPhantom(true);
        }
      })
      .catch(() => setPhantom(true));
  }, [slug, phase]);

  // StrictMode dev roda este efeito 2x (mount → cleanup → mount). O cleanup em
  // useArtifactAgent aborta o fetch da 1ª passada; a 2ª passada chama submit
  // de novo. Como submit retorna o outcome ("completed" | "aborted" | "error"),
  // só disparamos handleCompleted para a passada que realmente terminou.
  useEffect(() => {
    submit({ messages: [{ role: "user", content: initialInput }] })
      .then((result) => { if (result === "completed") handleCompleted(); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleApprove = useCallback(async () => {
    try {
      await approve(slug, phase.toUpperCase());
      onApproved(preview);
    } catch (e) {
      alert(`Erro ao aprovar: ${(e as Error).message}`);
    }
  }, [slug, phase, preview, onApproved]);

  const handleEdit = useCallback((instructions: string) => {
    const cur = preview;
    setShowEdit(false);
    setDone(false);
    setPhantom(false);
    setPreview("");
    submit({ messages: [{ role: "user", content: buildEditInput(phase, slug, cur, instructions) }] })
      .then((result) => { if (result === "completed") handleCompleted(); });
  }, [phase, slug, preview, submit, handleCompleted]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <span style={{ color: "#64748b", fontSize: "0.78rem", flex: 1 }}>
          {isLoading && "⏳ Gerando artefato, aguarde…"}
          {!isLoading && isError && "❌ Falhou"}
          {!isLoading && !isError && wasCanceled && "🚫 Cancelado pelo usuário"}
          {!isLoading && !isError && !wasCanceled && phantom && "⚠️ Agente terminou sem salvar — veja o log do backend"}
          {!isLoading && !isError && !wasCanceled && !phantom && done && "✅ Pronto para revisão"}
          {!isLoading && !isError && !wasCanceled && !phantom && !done && "Aguardando resposta…"}
        </span>
        {isLoading && (
          <button onClick={cancel} style={btn("#7f1d1d", "#fecaca")}>
            Cancelar
          </button>
        )}
        {done && !isError && !phantom && !wasCanceled && (
          <>
            <button onClick={() => setShowEdit(true)} style={btn("#f59e0b", "#0f1117")}>
              Solicitar alterações
            </button>
            <button onClick={handleApprove} style={btn("#22c55e", "#0f1117")}>
              Aprovar →
            </button>
          </>
        )}
      </div>

      {isError && (
        <div style={{
          padding: "0.75rem 1rem",
          background: "#1a0808",
          border: "1px solid #7f1d1d",
          borderRadius: "0.5rem",
          color: "#f87171",
          fontSize: "0.8rem",
        }}>
          Erro: {errorMessage}
        </div>
      )}

      {phantom && !isError && (
        <div style={{
          padding: "0.75rem 1rem",
          background: "#1a1300",
          border: "1px solid #78350f",
          borderRadius: "0.5rem",
          color: "#fbbf24",
          fontSize: "0.8rem",
          lineHeight: 1.5,
        }}>
          O stream fechou mas nenhum draft foi salvo em{" "}
          <code>.specs/drafts/{slug}/{phase.toUpperCase()}.md</code>.{" "}
          Provavelmente o agente esgotou as tentativas de <code>write_file</code> (MAX_RETRIES).{" "}
          Veja <code>backend/_debug_server_err.log</code> para a última tool-call.{" "}
          Clique em <strong>Re-gerar</strong> acima.
        </div>
      )}

      {!isError && !phantom && (isLoading ? (
        <div style={{ padding: "3rem 0", textAlign: "center", color: "#334155", fontSize: "0.85rem" }}>
          Aguardando o agente concluir…
        </div>
      ) : preview ? (
        <MarkdownPreview content={preview} />
      ) : null)}

      {showEdit && (
        <EditModeDialog onConfirm={handleEdit} onCancel={() => setShowEdit(false)} />
      )}
    </div>
  );
}

// ── PhaseSection ─────────────────────────────────────────────────────────────
type Mode = "idle" | "view-draft" | "generating";

export function PhaseSection({
  phase, slug, description, files,
  isApproved, isActive, isLocked, onApproved,
}: Props) {
  const [mode, setMode] = useState<Mode>("idle");
  const [streamKey, setStreamKey] = useState(0);
  const [pendingInput, setPendingInput] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [approvedContent, setApprovedContent] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [building, setBuilding] = useState(false);

  // Carrega draft existente quando a fase fica ativa
  useEffect(() => {
    if (!isActive || !slug || slug.length < 3) return;
    readDraft(slug, phase.toUpperCase())
      .then((d) => { if (d) setDraft(d); })
      .catch(() => {});
  }, [slug, phase, isActive]);

  // Carrega conteúdo aprovado ao expandir
  useEffect(() => {
    if (!isApproved || !expanded || approvedContent || !slug) return;
    readArtifact(slug, phase.toUpperCase())
      .then(setApprovedContent)
      .catch(() => {});
  }, [isApproved, expanded, slug, phase, approvedContent]);

  const buildInput = useCallback(async (currentContent?: string, editInstructions?: string) => {
    const selectedUploads = await Promise.all(
      files.filter((f) => f.selected).map(async (f) => {
        const data = await readExtracted(f.uploadSlug, f.filename);
        return { filename: f.filename, content: data.content };
      })
    );

    if (currentContent && editInstructions) {
      return buildEditInput(phase, slug, currentContent, editInstructions);
    }
    return buildInitialInput(phase, { slug, description, uploads: selectedUploads });
  }, [slug, description, files, phase]);

  const startGenerate = useCallback(async (fromContent?: string, editInstructions?: string) => {
    if (!slug) return;
    setBuilding(true);
    try {
      // Não apagamos o draft anterior aqui: write_file do deepagents sobrescreve
      // ("Updated file …" no tool_result, confirmado em log de repro). Se o agente
      // falhar (MAX_RETRIES ou exceção), o draft anterior fica preservado.
      const input = await buildInput(fromContent, editInstructions);
      setPendingInput(input);
      setStreamKey((k) => k + 1);
      setMode("generating");
    } finally {
      setBuilding(false);
    }
  }, [buildInput, slug]);

  const handleApproved = useCallback((content: string) => {
    setApprovedContent(content);
    onApproved();
  }, [onApproved]);

  const handleApproveDraft = useCallback(async () => {
    if (!draft) return;
    try {
      await approve(slug, phase.toUpperCase());
      setApprovedContent(draft);
      onApproved();
    } catch (e) {
      alert(`Erro ao aprovar: ${(e as Error).message}`);
    }
  }, [slug, phase, draft, onApproved]);

  const handleEditDraft = useCallback((instructions: string) => {
    setShowEdit(false);
    startGenerate(draft!, instructions);
  }, [draft, startGenerate]);

  // ── Fase bloqueada ───────────────────────────────────────────────────────
  if (isLocked) {
    return (
      <div style={card("#0f1117", "#1a2333", 0.45)}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <span style={{ fontSize: "1rem" }}>🔒</span>
          <span style={{ color: "#334155", fontWeight: 600 }}>{PHASE_LABELS[phase]}</span>
          <span style={{ color: "#293548", fontSize: "0.78rem" }}>{PHASE_DESCRIPTIONS[phase]}</span>
        </div>
      </div>
    );
  }

  // ── Fase aprovada ────────────────────────────────────────────────────────
  if (isApproved) {
    return (
      <div style={card("#0d1a11", "#1e3a28")}>
        <div
          style={{ display: "flex", alignItems: "center", gap: "0.75rem", cursor: "pointer" }}
          onClick={() => setExpanded((e) => !e)}
        >
          <span style={{ fontSize: "1rem" }}>✅</span>
          <span style={{ color: "#4ade80", fontWeight: 700 }}>{PHASE_LABELS[phase]}</span>
          <span style={{ color: "#4ade80", fontSize: "0.75rem", opacity: 0.7, flex: 1 }}>Aprovado</span>
          <span style={{ color: "#475569", fontSize: "0.75rem" }}>
            {expanded ? "▲ ocultar" : "▼ ver artefato"}
          </span>
        </div>
        {expanded && approvedContent && (
          <div style={{ marginTop: "1rem", borderTop: "1px solid #1e3a28", paddingTop: "1rem" }}>
            <MarkdownPreview content={approvedContent} />
          </div>
        )}
        {expanded && !approvedContent && (
          <div style={{ marginTop: "1rem", color: "#475569", fontSize: "0.8rem" }}>Carregando…</div>
        )}
      </div>
    );
  }

  // ── Fase ativa ───────────────────────────────────────────────────────────
  return (
    <div style={card("#0f1117", "#2d1a6e")}>
      {/* Cabeçalho */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
        <span style={{ color: "#a78bfa", fontWeight: 700, fontSize: "1rem" }}>{PHASE_LABELS[phase]}</span>
        <span style={{ color: "#475569", fontSize: "0.78rem", flex: 1 }}>{PHASE_DESCRIPTIONS[phase]}</span>
        <button
          onClick={() => startGenerate()}
          disabled={!slug || building}
          style={btn(slug && !building ? "#7c3aed" : "#334155", "#fff")}
        >
          {building ? "Preparando…" : mode === "generating" ? "Re-gerar" : draft && mode === "idle" ? "Re-gerar" : "Gerar"}
        </button>
      </div>
      {/* Sandbox é gerenciado automaticamente: o preflight em useArtifactAgent
          (POST /ensure/{slug}) cria/acorda/recria conforme necessário a cada
          Gerar. `sandboxReady` (vindo do polling de /sandboxes/{slug}) só
          informa o TerminalPanel — não gateia mais o botão. */}

      {/* Aviso de draft existente */}
      {draft && mode === "idle" && (
        <div style={{
          marginBottom: "1rem", padding: "0.75rem 1rem",
          background: "#1e293b", borderRadius: "0.5rem",
          display: "flex", alignItems: "center", gap: "0.75rem", fontSize: "0.8rem",
        }}>
          <span style={{ color: "#94a3b8", flex: 1 }}>
            Draft anterior encontrado. Deseja aprovar ou solicitar alterações?
          </span>
          <button onClick={() => setMode("view-draft")} style={btn("#7c3aed", "#fff", "sm")}>
            Ver draft
          </button>
        </div>
      )}

      {/* Visualização do draft (sem re-gerar) */}
      {mode === "view-draft" && draft && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem" }}>
            <span style={{ color: "#94a3b8", fontSize: "0.78rem", flex: 1 }}>
              Exibindo draft anterior
            </span>
            <button onClick={() => setShowEdit(true)} style={btn("#f59e0b", "#0f1117", "sm")}>
              Solicitar alterações
            </button>
            <button onClick={handleApproveDraft} style={btn("#22c55e", "#0f1117", "sm")}>
              Aprovar draft →
            </button>
          </div>
          <MarkdownPreview content={draft} />
          {showEdit && (
            <EditModeDialog onConfirm={handleEditDraft} onCancel={() => setShowEdit(false)} />
          )}
        </div>
      )}

      {/* Geração ativa */}
      {mode === "generating" && pendingInput && (
        <PhaseStream
          key={streamKey}
          phase={phase}
          slug={slug}
          initialInput={pendingInput}
          onApproved={handleApproved}
        />
      )}
    </div>
  );
}

function btn(bg: string, color: string, size?: "sm"): React.CSSProperties {
  return {
    padding: size === "sm" ? "0.3rem 0.6rem" : "0.45rem 0.9rem",
    borderRadius: "0.375rem", border: "none",
    background: bg, color, cursor: "pointer",
    fontSize: size === "sm" ? "0.78rem" : "0.85rem",
    fontWeight: 600, whiteSpace: "nowrap",
  };
}

function card(bg: string, border: string, opacity = 1): React.CSSProperties {
  return {
    background: bg,
    border: `1px solid ${border}`,
    borderRadius: "0.75rem",
    padding: "1.25rem",
    opacity,
  };
}
