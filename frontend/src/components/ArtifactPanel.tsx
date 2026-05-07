import { useCallback, useEffect, useRef, useState } from "react";
import { approve, listArtifacts, readArtifact, readDraft, writeDraft, readExtracted } from "../lib/api";
import { buildEditInput, buildInitialInput } from "../lib/prompts";
import type { Phase, UploadedFile } from "../lib/types";
import { PHASE_DESCRIPTIONS } from "../lib/types";
import { useArtifactAgent } from "../hooks/useArtifactAgent";
import { EditModeDialog } from "./EditModeDialog";
import { MarkdownPreview } from "./MarkdownPreview";
import { UploadDropzone } from "./UploadDropzone";

const MODEL_CONTEXT_WINDOW = 200_000;

interface PanelProps {
  phase: Phase;
  slug: string;
  onSlugChange: (slug: string) => void;
}

interface StreamViewProps {
  phase: Phase;
  slug: string;
  initialInput: string;
  onDone: (content: string) => void;
}

// ── StreamView: remontado a cada geração (novo thread sempre) ─────────────────
function ArtifactStreamView({ phase, slug, initialInput, onDone }: StreamViewProps) {
  const { content, isLoading, submit } = useArtifactAgent(phase);
  const submitted = useRef(false);
  const [previewContent, setPreviewContent] = useState("");
  const [status, setStatus] = useState<"streaming" | "done">("streaming");
  const [showEditDialog, setShowEditDialog] = useState(false);

  // Submit once on mount — fresh thread created inside hook
  useEffect(() => {
    if (!submitted.current && initialInput) {
      submitted.current = true;
      submit({ messages: [{ role: "user", content: initialInput }] });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Mirror streaming content into previewContent + debounced draft save
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!content) return;
    setPreviewContent(content);
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      if (slug) writeDraft(slug, phase.toUpperCase(), content).catch(console.error);
    }, 500);
  }, [content]); // eslint-disable-line react-hooks/exhaustive-deps

  // Detect end of stream → mark done and flush draft
  useEffect(() => {
    if (!isLoading && status === "streaming" && previewContent) {
      setStatus("done");
      if (slug) writeDraft(slug, phase.toUpperCase(), previewContent).catch(console.error);
    }
  }, [isLoading, previewContent]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleApprove = useCallback(async () => {
    try {
      await approve(slug, phase.toUpperCase());
      onDone(previewContent);
    } catch (e) {
      alert(`Erro ao aprovar: ${(e as Error).message}`);
    }
  }, [slug, phase, previewContent, onDone]);

  const handleEdit = useCallback(
    (instructions: string) => {
      const currentContent = previewContent;
      setShowEditDialog(false);
      setStatus("streaming");
      setPreviewContent("");
      const editContent = buildEditInput(phase, currentContent, instructions);
      submit({ messages: [{ role: "user", content: editContent }] });
    },
    [phase, previewContent, submit]
  );

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "#0f1117" }}>
      <div style={{
        padding: "0.75rem 1.25rem", borderBottom: "1px solid #1e293b",
        display: "flex", alignItems: "center", gap: "0.5rem",
      }}>
        <span style={{ color: "#64748b", fontSize: "0.78rem", flex: 1 }}>
          {isLoading && "⏳ Gerando…"}
          {!isLoading && status === "done" && "✅ Gerado — pronto para revisão"}
          {!isLoading && status === "streaming" && !previewContent && "Aguardando resposta…"}
        </span>
        {status === "done" && (
          <>
            <button onClick={() => setShowEditDialog(true)} style={actionBtnStyle("#f59e0b", "#0f1117")}>
              Solicitar alterações
            </button>
            <button onClick={handleApprove} style={actionBtnStyle("#22c55e", "#0f1117")}>
              Aprovar
            </button>
          </>
        )}
      </div>

      {previewContent ? (
        <MarkdownPreview content={previewContent} />
      ) : (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#334155" }}>
          {isLoading ? "Aguardando primeiros tokens…" : "O artefato gerado aparecerá aqui."}
        </div>
      )}

      {showEditDialog && (
        <EditModeDialog onConfirm={handleEdit} onCancel={() => setShowEditDialog(false)} />
      )}
    </div>
  );
}

// ── ArtifactPanel: mantém formulário, remonta StreamView a cada geração ───────
export function ArtifactPanel({ phase, slug, onSlugChange }: PanelProps) {
  const [description, setDescription] = useState("");
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [includePrevious, setIncludePrevious] = useState(false);
  const [availablePrevious, setAvailablePrevious] = useState<string[]>([]);

  const [streamKey, setStreamKey] = useState(0);
  const [pendingInput, setPendingInput] = useState<string | null>(null);
  const [existingDraft, setExistingDraft] = useState<string | null>(null);
  const [approvedContent, setApprovedContent] = useState<string | null>(null);

  // Carrega draft e artefatos aprovados apenas quando slug está completo (≥3 chars)
  useEffect(() => {
    if (!slug || slug.length < 3) return;
    const timer = setTimeout(() => {
      readDraft(slug, phase.toUpperCase()).then(setExistingDraft).catch(() => {});
      listArtifacts(slug).then(setAvailablePrevious).catch(() => {});
    }, 400);
    return () => clearTimeout(timer);
  }, [slug, phase]);

  const totalTokens =
    uploadedFiles.filter((f) => f.selected).reduce((s, f) => s + f.approxTokens, 0) +
    Math.ceil(description.length / 4);
  const tokenWarning = totalTokens > MODEL_CONTEXT_WINDOW * 0.8;

  const handleGenerate = useCallback(async () => {
    if (!slug) return;

    const selectedUploads = await Promise.all(
      uploadedFiles
        .filter((f) => f.selected)
        .map(async (f) => {
          const data = await readExtracted(f.uploadSlug, f.filename);
          return { filename: f.filename, content: data.content };
        })
    );

    const previous: Partial<Record<Phase, string>> = {};
    if (includePrevious) {
      for (const p of availablePrevious) {
        const c = await readArtifact(slug, p);
        if (c) previous[p.toLowerCase() as Phase] = c;
      }
    }

    const content = buildInitialInput(phase, { slug, description, previous, uploads: selectedUploads });
    setPendingInput(content);
    setApprovedContent(null);
    setStreamKey((k) => k + 1); // força remount do StreamView = novo thread
  }, [slug, description, uploadedFiles, includePrevious, availablePrevious, phase]);

  return (
    <div style={{ display: "flex", height: "100%", gap: "1px", background: "#1e293b" }}>
      {/* Formulário */}
      <div style={{
        width: "340px", flexShrink: 0, background: "#0f1117", padding: "1.25rem",
        display: "flex", flexDirection: "column", gap: "1rem", overflowY: "auto",
      }}>
        <p style={{ color: "#64748b", fontSize: "0.78rem" }}>{PHASE_DESCRIPTIONS[phase]}</p>

        <div>
          <label style={labelStyle}>Slug do épico</label>
          <input
            value={slug}
            onChange={(e) => onSlugChange(e.target.value.toLowerCase().replace(/\s+/g, "-"))}
            placeholder="ex: seconci-app"
            style={inputStyle}
          />
        </div>

        <div>
          <label style={labelStyle}>Descrição / contexto</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            placeholder="Descreva o produto, épico ou feature a ser documentado..."
            style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
          />
        </div>

        <div>
          <label style={labelStyle}>Documentos base</label>
          <UploadDropzone slug={slug || "default"} files={uploadedFiles} onChange={setUploadedFiles} />
        </div>

        {availablePrevious.length > 0 && (
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", fontSize: "0.82rem", color: "#94a3b8" }}>
            <input
              type="checkbox"
              checked={includePrevious}
              onChange={(e) => setIncludePrevious(e.target.checked)}
              style={{ accentColor: "#7c3aed" }}
            />
            Incluir artefatos aprovados ({availablePrevious.join(", ")})
          </label>
        )}

        {tokenWarning && (
          <p style={{ color: "#f87171", fontSize: "0.78rem" }}>
            ⚠ ~{totalTokens.toLocaleString()} tokens estimados — próximo do limite.
          </p>
        )}

        <button
          onClick={handleGenerate}
          disabled={!slug}
          style={{
            padding: "0.625rem", borderRadius: "0.5rem", border: "none",
            background: slug ? "#7c3aed" : "#334155",
            color: slug ? "#fff" : "#64748b",
            cursor: slug ? "pointer" : "not-allowed",
            fontWeight: 600, fontSize: "0.875rem",
          }}
        >
          Gerar
        </button>

        {existingDraft && streamKey === 0 && !pendingInput && (
          <p style={{ color: "#94a3b8", fontSize: "0.75rem" }}>
            Draft anterior disponível. Clique em Gerar para substituir.
          </p>
        )}

        {approvedContent && (
          <p style={{ color: "#4ade80", fontSize: "0.75rem" }}>
            ✅ Artefato aprovado e salvo em .specs/features/{slug}/
          </p>
        )}
      </div>

      {/* Stream / preview */}
      {pendingInput ? (
        <ArtifactStreamView
          key={streamKey}
          phase={phase}
          slug={slug}
          initialInput={pendingInput}
          onDone={(content) => setApprovedContent(content)}
        />
      ) : (
        <div style={{
          flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
          color: "#334155", flexDirection: "column", gap: "0.5rem",
        }}>
          <span style={{ fontSize: "2rem" }}>📄</span>
          <span style={{ fontSize: "0.85rem" }}>Preencha o slug e a descrição, depois clique em Gerar.</span>
        </div>
      )}
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block", fontSize: "0.78rem", color: "#64748b",
  marginBottom: "0.35rem", fontWeight: 500,
};

const inputStyle: React.CSSProperties = {
  width: "100%", background: "#1e293b", border: "1px solid #334155",
  borderRadius: "0.375rem", color: "#e2e8f0", padding: "0.5rem 0.625rem",
  fontSize: "0.875rem", outline: "none",
};

function actionBtnStyle(bg: string, fg: string): React.CSSProperties {
  return {
    padding: "0.375rem 0.75rem", borderRadius: "0.375rem", border: "none",
    background: bg, color: fg, cursor: "pointer", fontSize: "0.8rem", fontWeight: 600,
  };
}
