import { useEffect, useState } from "react";
import { listFeatures } from "../lib/api";
import { PHASES, PHASE_LABELS } from "../lib/types";
import type { Phase } from "../lib/types";

interface Props {
  activePhase: Phase;
  onPhaseChange: (phase: Phase) => void;
  slug: string;
  onSlugChange: (slug: string) => void;
}

export function ArtifactSidebar({ activePhase, onPhaseChange, slug, onSlugChange }: Props) {
  const [features, setFeatures] = useState<string[]>([]);

  useEffect(() => {
    listFeatures().then(setFeatures).catch(() => {});
  }, []);

  return (
    <aside style={{
      width: "220px", flexShrink: 0, background: "#0a0e17",
      borderRight: "1px solid #1e293b", display: "flex", flexDirection: "column",
      padding: "1rem 0",
    }}>
      <div style={{ padding: "0 1rem 0.75rem", borderBottom: "1px solid #1e293b", marginBottom: "0.5rem" }}>
        <p style={{ color: "#64748b", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.5rem" }}>
          Artefatos
        </p>
        {PHASES.map((p) => (
          <button
            key={p}
            onClick={() => onPhaseChange(p)}
            style={{
              display: "block", width: "100%", textAlign: "left",
              padding: "0.45rem 0.625rem", borderRadius: "0.375rem", border: "none",
              background: activePhase === p ? "#1e1b4b" : "transparent",
              color: activePhase === p ? "#a78bfa" : "#94a3b8",
              cursor: "pointer", fontSize: "0.85rem", fontWeight: activePhase === p ? 600 : 400,
              marginBottom: "0.15rem", transition: "background 0.1s",
            }}
          >
            {PHASE_LABELS[p]}
          </button>
        ))}
      </div>

      {features.length > 0 && (
        <div style={{ padding: "0 1rem" }}>
          <p style={{ color: "#64748b", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.5rem" }}>
            Épicos aprovados
          </p>
          {features.map((f) => (
            <button
              key={f}
              onClick={() => onSlugChange(f)}
              style={{
                display: "block", width: "100%", textAlign: "left",
                padding: "0.4rem 0.625rem", borderRadius: "0.375rem", border: "none",
                background: slug === f ? "#0f2d1b" : "transparent",
                color: slug === f ? "#4ade80" : "#64748b",
                cursor: "pointer", fontSize: "0.78rem", whiteSpace: "nowrap",
                overflow: "hidden", textOverflow: "ellipsis",
                marginBottom: "0.1rem",
              }}
              title={f}
            >
              {f}
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}
