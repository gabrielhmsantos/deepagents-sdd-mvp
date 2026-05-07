import { useCallback, useEffect, useRef, useState } from "react";
import { approve, deleteDraft, readArtifact, readDraft, readExtracted } from "../lib/api";
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
  previousPhases: Phase[];       // fases já aprovadas antes desta
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
  const { content, isLoading, submit } = useArtifactAgent(phase);
  const submitted = useRef(false);
  const [preview, setPreview] = useState("");
  const [done, setDone] = useState(false);
  const [showEdit, setShowEdit] = useState(false);

  useEffect(() => {
    if (!submitted.current) {
      submitted.current = true;
      submit({ messages: [{ role: "user", content: initialInput }] });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Espelha content → preview (preview em tempo real enquanto o agente gera)
  useEffect(() => {
    if (!content) return;
    setPreview(content);
  }, [content]);

  // Fim do stream: lê o arquivo que o agente salvou como fonte autoritativa
  useEffect(() => {
    if (!isLoading && !done && (preview || content !== undefined)) {
      setDone(true);
      readDraft(slug, phase.toUpperCase())
        .then((saved) => { if (saved) setPreview(saved); })
        .catch(() => {}); // fallback: mantém o conteúdo do stream
    }
  }, [isLoading]); // eslint-disable-line react-hooks/exhaustive-deps

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
    setPreview("");
    submit({ messages: [{ role: "user", content: buildEditInput(phase, cur, instructions) }] });
  }, [phase, preview, submit]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <span style={{ color: "#64748b", fontSize: "0.78rem", flex: 1 }}>
          {isLoading && "⏳ Gerando…"}
          {!isLoading && done && "✅ Pronto para revisão"}
          {!isLoading && !done && !preview && "Aguardando resposta…"}
        </span>
        {done && (
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

      {preview ? (
        <MarkdownPreview content={preview} />
      ) : (
        <div style={{ padding: "3rem 0", textAlign: "center", color: "#334155", fontSize: "0.85rem" }}>
          {isLoading ? "Aguardando primeiros tokens…" : ""}
        </div>
      )}

      {showEdit && (
        <EditModeDialog onConfirm={handleEdit} onCancel={() => setShowEdit(false)} />
      )}
    </div>
  );
}

// ── PhaseSection ─────────────────────────────────────────────────────────────
type Mode = "idle" | "view-draft" | "generating";

export function PhaseSection({
  phase, slug, description, files, previousPhases,
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

    const previous: Partial<Record<Phase, string>> = {};
    for (const p of previousPhases) {
      const c = await readArtifact(slug, p.toUpperCase());
      if (c) previous[p] = c;
    }

    if (currentContent && editInstructions) {
      return buildEditInput(phase, currentContent, editInstructions);
    }
    return buildInitialInput(phase, { slug, description, previous, uploads: selectedUploads });
  }, [slug, description, files, previousPhases, phase]);

  const startGenerate = useCallback(async (fromContent?: string, editInstructions?: string) => {
    if (!slug) return;
    setBuilding(true);
    try {
      // Apaga draft anterior para que o agente possa criar com write_file (que falha se já existe)
      await deleteDraft(slug, phase.toUpperCase()).catch(() => {});
      const input = await buildInput(fromContent, editInstructions);
      setPendingInput(input);
      setStreamKey((k) => k + 1);
      setMode("generating");
    } finally {
      setBuilding(false);
    }
  }, [buildInput, slug, phase]);

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
