import { useState } from "react";
import { friendlyError } from "../lib/api";
import type { Project } from "../lib/types";
import { ConfirmModal } from "./ConfirmModal";
import { useToast } from "./Toast";

interface Props {
  project: Project;
  onReset: () => Promise<void>;
}

const s = {
  bg: "#0f1117",
  surface: "#1e293b",
  border: "#1e293b",
  text: "#e2e8f0",
  muted: "#64748b",
  red: "#f87171",
  green: "#4ade80",
};

export function ProjectHeader({ project, onReset }: Props) {
  const [showReset, setShowReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const { showToast } = useToast();

  const hasRepo = project.github_repo_owner && project.github_repo_name;

  async function doReset() {
    setResetting(true);
    try {
      await onReset();
      showToast(`Projeto '${project.slug}' reiniciado`, "info");
    } catch (e) {
      showToast(friendlyError(e), "error");
    } finally {
      setResetting(false);
      setShowReset(false);
    }
  }

  return (
    <>
      <div
        style={{
          background: s.bg,
          border: `1px solid ${s.border}`,
          borderRadius: 8,
          padding: "0.75rem 1rem",
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          flexWrap: "wrap",
        }}
      >
        {/* Slug */}
        <span style={{ fontWeight: 700, fontSize: "0.9rem", color: s.text }}>
          {project.slug}
        </span>

        {/* SSG_ID badge */}
        {project.ssg_id && (
          <span
            style={{
              fontSize: "0.7rem",
              color: s.muted,
              background: s.surface,
              border: `1px solid #334155`,
              padding: "2px 8px",
              borderRadius: 4,
              fontFamily: "monospace",
            }}
          >
            #{project.ssg_id}
          </span>
        )}

        {/* Mode badge */}
        <span
          style={{
            fontSize: "0.7rem",
            fontWeight: 600,
            color: hasRepo ? s.green : "#f59e0b",
            background: hasRepo ? "#0d1a11" : "#1c1709",
            border: `1px solid ${hasRepo ? "#1e3a28" : "#7c5e10"}`,
            padding: "2px 8px",
            borderRadius: 4,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          {hasRepo ? "brownfield" : "greenfield"}
        </span>

        {/* Repo info */}
        {hasRepo && (
          <span
            style={{
              fontSize: "0.75rem",
              color: s.muted,
              fontFamily: "monospace",
            }}
          >
            {project.github_repo_owner}/{project.github_repo_name}
            <span style={{ color: "#334155", margin: "0 4px" }}>@</span>
            {project.github_default_branch || "main"}
          </span>
        )}

        {/* Reset button — push to right */}
        <button
          onClick={() => setShowReset(true)}
          style={{
            marginLeft: "auto",
            background: "transparent",
            border: `1px solid #7f1d1d`,
            borderRadius: 6,
            color: s.red,
            padding: "4px 12px",
            fontSize: 11,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Reiniciar projeto
        </button>
      </div>

      <ConfirmModal
        open={showReset}
        title="Reiniciar projeto?"
        message={`Isso apaga o sandbox + todos os drafts e artefatos aprovados do slug '${project.slug}'. ` +
          "Você pode recriar o projeto com os mesmos dados depois, mas vai perder tudo que foi gerado até agora. Tem certeza?"}
        confirmLabel="Sim, reiniciar"
        cancelLabel="Voltar"
        intent="danger"
        busy={resetting}
        onConfirm={doReset}
        onClose={() => setShowReset(false)}
      />
    </>
  );
}
