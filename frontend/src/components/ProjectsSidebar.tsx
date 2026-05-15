import type { AdminProjectRow } from "../lib/types";
import { PHASES, PHASE_LABELS } from "../lib/types";

interface Props {
  entries: AdminProjectRow[];
  activeSlug: string | null;
  activeView: "project" | "settings";
  onSelectProject: (slug: string) => void;
  onNewProject: () => void;
  onOpenSettings: () => void;
}

const s = {
  bg: "#0f1117",
  surface: "#1e293b",
  border: "#1e293b",
  borderHover: "#334155",
  text: "#e2e8f0",
  muted: "#64748b",
  purple: "#7c3aed",
  green: "#4ade80",
  gray: "#1e293b",
};

export function ProjectsSidebar({
  entries,
  activeSlug,
  activeView,
  onSelectProject,
  onNewProject,
  onOpenSettings,
}: Props) {
  return (
    <aside
      style={{
        width: 280,
        flexShrink: 0,
        background: s.bg,
        borderRight: `1px solid ${s.border}`,
        display: "flex",
        flexDirection: "column",
        height: "100dvh",
        color: s.text,
      }}
    >
      {/* Brand */}
      <div
        style={{
          padding: "1rem 1.25rem",
          borderBottom: `1px solid ${s.border}`,
          fontWeight: 700,
          fontSize: "0.95rem",
          color: s.purple,
        }}
      >
        ✦ Champion AI
        <span style={{ marginLeft: 6, color: "#334155", fontSize: "0.7rem" }}>SDD Studio</span>
      </div>

      {/* + Novo */}
      <div style={{ padding: "0.75rem" }}>
        <button
          onClick={onNewProject}
          style={{
            width: "100%",
            padding: "0.5rem 0.75rem",
            background: "transparent",
            border: `1px dashed ${s.borderHover}`,
            borderRadius: 6,
            color: s.text,
            fontSize: "0.8rem",
            fontWeight: 600,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.4rem",
          }}
        >
          + Novo projeto
        </button>
      </div>

      {/* Lista de projetos */}
      <nav style={{ flex: 1, overflowY: "auto", padding: "0 0.5rem" }}>
        {entries.length === 0 ? (
          <p style={{ color: s.muted, fontSize: "0.75rem", padding: "1rem 0.75rem", textAlign: "center" }}>
            Nenhum projeto ainda. Clique em "+ Novo projeto" pra começar.
          </p>
        ) : (
          <div
            style={{
              fontSize: "0.65rem",
              color: s.muted,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              padding: "0.5rem 0.75rem 0.25rem",
            }}
          >
            Projetos ({entries.length})
          </div>
        )}

        {entries.map((p) => {
          const isActive = activeSlug === p.slug && activeView === "project";
          return (
            <button
              key={p.slug}
              onClick={() => onSelectProject(p.slug)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                background: isActive ? s.surface : "transparent",
                border: "none",
                borderRadius: 6,
                padding: "0.5rem 0.75rem",
                marginBottom: 2,
                color: s.text,
                cursor: "pointer",
              }}
              onMouseEnter={(e) => {
                if (!isActive) e.currentTarget.style.background = "#171c26";
              }}
              onMouseLeave={(e) => {
                if (!isActive) e.currentTarget.style.background = "transparent";
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: 4 }}>
                <span
                  style={{
                    fontSize: "0.8rem",
                    fontWeight: 600,
                    flex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {p.idea_snippet || p.slug}
                </span>
                {p.ssg_id && (
                  <span
                    style={{
                      fontSize: "0.65rem",
                      color: s.muted,
                      background: "#0a0d14",
                      border: `1px solid ${s.border}`,
                      padding: "1px 5px",
                      borderRadius: 4,
                      fontFamily: "monospace",
                    }}
                  >
                    #{p.ssg_id}
                  </span>
                )}
              </div>
              <div style={{ fontSize: "0.65rem", color: s.muted, fontFamily: "monospace", marginBottom: 4 }}>
                {p.slug}
              </div>
              {/* 5 dots de fases */}
              <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
                {PHASES.map((phase) => {
                  const approved = p.approved_phases.includes(phase.toUpperCase());
                  return (
                    <span
                      key={phase}
                      title={PHASE_LABELS[phase]}
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        background: approved ? s.green : s.gray,
                        border: approved ? "none" : `1px solid ${s.borderHover}`,
                        flexShrink: 0,
                      }}
                    />
                  );
                })}
                <span style={{ fontSize: "0.65rem", color: s.muted, marginLeft: 4 }}>
                  {p.approved_count}/{p.total_phases}
                </span>
              </div>
            </button>
          );
        })}
      </nav>

      {/* Configurações footer */}
      <div style={{ padding: "0.5rem", borderTop: `1px solid ${s.border}` }}>
        <button
          onClick={onOpenSettings}
          style={{
            display: "flex",
            width: "100%",
            textAlign: "left",
            background: activeView === "settings" ? s.surface : "transparent",
            border: "none",
            borderRadius: 6,
            padding: "0.5rem 0.75rem",
            color: s.text,
            fontSize: "0.8rem",
            fontWeight: 600,
            cursor: "pointer",
            alignItems: "center",
            gap: "0.4rem",
          }}
          onMouseEnter={(e) => {
            if (activeView !== "settings") e.currentTarget.style.background = "#171c26";
          }}
          onMouseLeave={(e) => {
            if (activeView !== "settings") e.currentTarget.style.background = "transparent";
          }}
        >
          ⚙ Configurações
        </button>
      </div>
    </aside>
  );
}
