import { useRef, useState } from "react";
import { createProject, friendlyError, uploadFile } from "../lib/api";
import type { ProjectCreateResponse } from "../lib/types";
import { GreenfieldWarningModal } from "./GreenfieldWarningModal";
import { RepoPicker, type RepoSelection } from "./RepoPicker";
import { useToast } from "./Toast";

interface Props {
  onProjectCreated: (resp: ProjectCreateResponse) => void;
  onOpenSettings: () => void;
}

const s = {
  bg: "#0f1117",
  surface: "#1e293b",
  border: "#334155",
  text: "#e2e8f0",
  muted: "#64748b",
  purple: "#7c3aed",
  red: "#f87171",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: s.bg,
  border: `1px solid ${s.border}`,
  borderRadius: 6,
  color: s.text,
  padding: "8px 12px",
  fontSize: 13,
  outline: "none",
  boxSizing: "border-box",
  fontFamily: "inherit",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.73rem",
  color: s.muted,
  marginBottom: "0.3rem",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

// Arquivo pendente (ainda não fez upload — aguardando criação do projeto).
interface PendingFile {
  file: File;
  name: string;
}

const ALLOWED_EXTS = [".pdf", ".docx", ".txt", ".md"];

export function ProjectForm({ onProjectCreated, onOpenSettings }: Props) {
  const [ssgId, setSsgId] = useState("");
  const [idea, setIdea] = useState("");
  const [repo, setRepo] = useState<RepoSelection | null>(null);
  const [branchOverride, setBranchOverride] = useState("");
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showGreenfieldWarning, setShowGreenfieldWarning] = useState(false);
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const effectiveBranch = branchOverride.trim() || repo?.default_branch || "";
  const canSubmit = idea.trim().length > 0 && !isSubmitting;

  function handleFilesPicked(fileList: FileList) {
    const newFiles: PendingFile[] = [];
    for (const file of Array.from(fileList)) {
      const ext = "." + file.name.split(".").pop()?.toLowerCase();
      if (!ALLOWED_EXTS.includes(ext)) {
        showToast(`Formato não suportado: ${file.name}`, "error");
        continue;
      }
      // Evita duplicatas pelo nome.
      if (pendingFiles.some((p) => p.name === file.name)) continue;
      newFiles.push({ file, name: file.name });
    }
    if (newFiles.length) {
      setPendingFiles((prev) => [...prev, ...newFiles]);
    }
  }

  function removePendingFile(name: string) {
    setPendingFiles((prev) => prev.filter((p) => p.name !== name));
  }

  async function doSubmit() {
    setError(null);
    setIsSubmitting(true);
    try {
      // 1. Cria projeto (slug auto-gerado no backend).
      const resp = await createProject({
        ssg_id: ssgId.trim() || null,
        github_repo_owner: repo?.owner ?? null,
        github_repo_name: repo?.name ?? null,
        github_default_branch: effectiveBranch || null,
        idea: idea.trim() || null,
      });

      // 2. Upload dos arquivos pendentes em paralelo.
      if (pendingFiles.length > 0) {
        const uploadResults = await Promise.allSettled(
          pendingFiles.map((pf) => uploadFile(resp.slug, pf.file))
        );
        const failures = uploadResults.filter((r) => r.status === "rejected");
        if (failures.length > 0) {
          showToast(
            `${failures.length} arquivo(s) falharam no upload. Os demais foram enviados.`,
            "error"
          );
        }
      }

      showToast(`Projeto '${resp.slug}' criado (${resp.mode})`, "success");
      onProjectCreated(resp);
    } catch (e) {
      const friendly = friendlyError(e);
      setError(friendly);
      showToast(friendly, "error");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleSubmitClick() {
    if (!repo) {
      setShowGreenfieldWarning(true);
      return;
    }
    doSubmit();
  }

  return (
    <div
      style={{
        maxWidth: 640,
        margin: "0 auto",
        padding: "1.5rem",
        display: "flex",
        flexDirection: "column",
        gap: "1rem",
      }}
    >
      <div style={{ textAlign: "center", marginBottom: "0.5rem" }}>
        <div style={{ fontSize: "2.5rem", color: s.muted, marginBottom: "0.5rem" }}>✦</div>
        <h2 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700, color: s.text }}>
          Criar novo projeto
        </h2>
        <p style={{ margin: "0.5rem 0 0", fontSize: "0.8rem", color: s.muted, lineHeight: 1.5 }}>
          Preencha a ideia, adicione documentos base e (opcionalmente) conecte um repositório GitHub.
        </p>
      </div>

      {/* SSG_ID */}
      <div>
        <label style={labelStyle}>SSG ID</label>
        <input
          style={{ ...inputStyle, fontFamily: "monospace", maxWidth: 160 }}
          value={ssgId}
          onChange={(e) => setSsgId(e.target.value.replace(/\D/g, "").slice(0, 5))}
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={5}
          placeholder="12345"
          disabled={isSubmitting}
        />
      </div>

      {/* Idea textarea */}
      <div>
        <label style={labelStyle}>Ideia / descrição do projeto</label>
        <textarea
          style={{ ...inputStyle, minHeight: 120, resize: "vertical", lineHeight: 1.5 }}
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          placeholder="Descreva o produto, épico ou feature a ser documentado…"
          disabled={isSubmitting}
        />
      </div>

      {/* Documentos base (inline upload dropzone) */}
      <div>
        <label style={labelStyle}>Documentos base</label>
        <div
          role="button"
          tabIndex={0}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => e.key === "Enter" && fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files.length) handleFilesPicked(e.dataTransfer.files);
          }}
          style={{
            border: "1.5px dashed #475569",
            borderRadius: "0.5rem",
            padding: "0.75rem 1rem",
            cursor: "pointer",
            textAlign: "center",
            color: "#64748b",
            fontSize: "0.8rem",
            transition: "border-color 0.15s",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#7c3aed")}
          onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#475569")}
        >
          Soltar PDF / DOCX / TXT / MD aqui ou{" "}
          <span style={{ color: "#a78bfa", textDecoration: "underline" }}>clique para selecionar</span>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,.txt,.md"
          multiple
          style={{ display: "none" }}
          onChange={(e) => {
            if (e.target.files?.length) handleFilesPicked(e.target.files);
          }}
        />
        {pendingFiles.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", marginTop: "0.5rem" }}>
            {pendingFiles.map((pf) => (
              <div
                key={pf.name}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  background: s.surface,
                  border: `1px solid ${s.border}`,
                  borderRadius: "0.375rem",
                  padding: "0.4rem 0.6rem",
                  fontSize: "0.78rem",
                }}
              >
                <span style={{ flex: 1, color: "#cbd5e1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  📎 {pf.name}
                </span>
                <span style={{ color: s.muted, whiteSpace: "nowrap" }}>
                  {(pf.file.size / 1024).toFixed(0)} KB
                </span>
                <button
                  onClick={() => removePendingFile(pf.name)}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: s.muted,
                    fontSize: "0.9rem",
                    lineHeight: 1,
                  }}
                  title="Remover"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* GitHub repo picker */}
      <div>
        <label style={labelStyle}>
          GitHub repo <span style={{ textTransform: "none", color: s.muted }}>(brownfield — opcional pra greenfield)</span>
        </label>
        <RepoPicker
          value={repo}
          onChange={(sel) => {
            setRepo(sel);
            if (sel && !branchOverride.trim()) {
              setBranchOverride(""); // re-uses sel.default_branch via effectiveBranch
            }
          }}
          onOpenSettings={onOpenSettings}
        />
      </div>

      {/* Branch override (visível só com repo selecionado) */}
      {repo && (
        <div>
          <label style={labelStyle}>
            Branch <span style={{ textTransform: "none", color: s.muted }}>(default: {repo.default_branch})</span>
          </label>
          <input
            style={{ ...inputStyle, fontFamily: "monospace" }}
            value={branchOverride}
            onChange={(e) => setBranchOverride(e.target.value)}
            placeholder={repo.default_branch}
            disabled={isSubmitting}
          />
        </div>
      )}

      {/* Submit */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginTop: "0.5rem" }}>
        <button
          onClick={handleSubmitClick}
          disabled={!canSubmit}
          style={{
            background: canSubmit ? s.purple : s.surface,
            color: canSubmit ? "#fff" : s.muted,
            border: "none",
            borderRadius: 6,
            padding: "10px 24px",
            fontSize: 13,
            fontWeight: 600,
            cursor: canSubmit ? "pointer" : "not-allowed",
          }}
        >
          {isSubmitting ? "Criando projeto…" : "Criar projeto"}
        </button>
        {error && (
          <span style={{ fontSize: "0.78rem", color: s.red, flex: 1 }}>
            {error}
          </span>
        )}
      </div>

      <GreenfieldWarningModal
        open={showGreenfieldWarning}
        onConfirm={() => {
          setShowGreenfieldWarning(false);
          doSubmit();
        }}
        onClose={() => setShowGreenfieldWarning(false)}
      />
    </div>
  );
}
