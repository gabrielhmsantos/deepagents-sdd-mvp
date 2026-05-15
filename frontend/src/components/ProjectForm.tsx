import { useState } from "react";
import { createProject, friendlyError } from "../lib/api";
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

function normalizeSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/--+/g, "-");
}

export function ProjectForm({ onProjectCreated, onOpenSettings }: Props) {
  const [slugInput, setSlugInput] = useState("");
  const [ssgId, setSsgId] = useState("");
  const [idea, setIdea] = useState("");
  const [repo, setRepo] = useState<RepoSelection | null>(null);
  const [branchOverride, setBranchOverride] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showGreenfieldWarning, setShowGreenfieldWarning] = useState(false);
  const { showToast } = useToast();

  const slug = normalizeSlug(slugInput);
  const effectiveBranch = branchOverride.trim() || repo?.default_branch || "";
  const canSubmit = slug.length >= 3 && idea.trim().length > 0 && !isSubmitting;

  async function doSubmit() {
    setError(null);
    setIsSubmitting(true);
    try {
      const resp = await createProject({
        slug,
        ssg_id: ssgId.trim() || null,
        github_repo_owner: repo?.owner ?? null,
        github_repo_name: repo?.name ?? null,
        github_default_branch: effectiveBranch || null,
        idea: idea.trim() || null,
      });
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
          Preencha a ideia e (opcionalmente) conecte um repositório GitHub.
          O primeiro artefato fica bloqueado até o submit.
        </p>
      </div>

      {/* Slug + SSG_ID lado a lado */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 140px", gap: "0.75rem" }}>
        <div>
          <label style={labelStyle}>Slug do épico</label>
          <input
            style={inputStyle}
            value={slugInput}
            onChange={(e) => setSlugInput(e.target.value)}
            placeholder="ex: meu-epico"
            disabled={isSubmitting}
          />
          {slug && slug !== slugInput && (
            <p style={{ fontSize: "0.7rem", color: s.muted, margin: "0.25rem 0 0" }}>
              → <code style={{ background: s.surface, padding: "1px 5px", borderRadius: 3 }}>{slug}</code>
            </p>
          )}
        </div>
        <div>
          <label style={labelStyle}>SSG ID</label>
          <input
            style={{ ...inputStyle, fontFamily: "monospace", textAlign: "center" }}
            value={ssgId}
            onChange={(e) => setSsgId(e.target.value.replace(/\D/g, "").slice(0, 5))}
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={5}
            placeholder="12345"
            disabled={isSubmitting}
          />
        </div>
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
