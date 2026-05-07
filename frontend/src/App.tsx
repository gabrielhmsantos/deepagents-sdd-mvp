import { useCallback, useEffect, useState } from "react";
import { listArtifacts } from "./lib/api";
import { PHASES, PHASE_LABELS } from "./lib/types";
import type { Phase, UploadedFile } from "./lib/types";
import { PhaseSection } from "./components/PhaseSection";
import { UploadDropzone } from "./components/UploadDropzone";

// ── Persistência em localStorage ────────────────────────────────────────────
function useLocalStorage<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw !== null ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });

  const set = useCallback(
    (v: T | ((p: T) => T)) => {
      setValue((prev) => {
        const next = typeof v === "function" ? (v as (p: T) => T)(prev) : v;
        try { localStorage.setItem(key, JSON.stringify(next)); } catch {}
        return next;
      });
    },
    [key]
  );

  return [value, set];
}

// ── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [slug, setSlugRaw] = useLocalStorage("champion-slug", "");
  const [description, setDescription] = useLocalStorage("champion-description", "");
  const [files, setFiles] = useLocalStorage<UploadedFile[]>("champion-files", []);

  const [approvedPhases, setApprovedPhases] = useState<Set<Phase>>(new Set());
  const [phasesDirty, setPhasesDirty] = useState(0); // incrementar força recarga

  const setSlug = useCallback(
    (raw: string) => setSlugRaw(raw.toLowerCase().replace(/\s+/g, "-")),
    [setSlugRaw]
  );

  // Sincroniza fases aprovadas do backend sempre que slug muda ou aprovação ocorre
  useEffect(() => {
    if (!slug || slug.length < 3) {
      setApprovedPhases(new Set());
      return;
    }
    listArtifacts(slug)
      .then((phases) =>
        setApprovedPhases(new Set(phases.map((p) => p.toLowerCase() as Phase)))
      )
      .catch(() => setApprovedPhases(new Set()));
  }, [slug, phasesDirty]);

  const handleApproved = useCallback(() => {
    setPhasesDirty((n) => n + 1);
  }, []);

  const activePhase = PHASES.find((p) => !approvedPhases.has(p));
  const allDone = approvedPhases.size === PHASES.length;

  return (
    <div style={{ minHeight: "100vh", background: "#0a0d14", color: "#e2e8f0", fontFamily: "system-ui, sans-serif" }}>

      {/* Cabeçalho */}
      <header style={{
        height: "48px", display: "flex", alignItems: "center",
        padding: "0 1.5rem", gap: "0.75rem",
        borderBottom: "1px solid #1e293b", background: "#0f1117",
      }}>
        <span style={{ color: "#7c3aed", fontWeight: 700, fontSize: "0.9rem" }}>Champion AI</span>
        <span style={{ color: "#334155", fontSize: "0.8rem" }}>SDD Studio</span>
        {slug && (
          <>
            <span style={{ color: "#1e293b" }}>·</span>
            <span style={{ color: "#64748b", fontSize: "0.8rem" }}>{slug}</span>
          </>
        )}
        {/* mini progresso */}
        <div style={{ marginLeft: "auto", display: "flex", gap: "0.35rem", alignItems: "center" }}>
          {PHASES.map((p) => (
            <div
              key={p}
              title={PHASE_LABELS[p]}
              style={{
                width: "8px", height: "8px", borderRadius: "50%",
                background: approvedPhases.has(p) ? "#4ade80" : p === activePhase ? "#7c3aed" : "#1e293b",
              }}
            />
          ))}
        </div>
      </header>

      {/* Formulário compartilhado */}
      <div style={{
        borderBottom: "1px solid #1e293b", background: "#0f1117",
        padding: "1.25rem 1.5rem",
      }}>
        <div style={{ maxWidth: "960px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div style={{ display: "flex", gap: "1rem", alignItems: "flex-start", flexWrap: "wrap" }}>
            <div style={{ flex: "0 0 220px" }}>
              <label style={labelStyle}>Slug do épico</label>
              <input
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="ex: seconci-app"
                style={inputStyle}
              />
            </div>
            <div style={{ flex: 1, minWidth: "200px" }}>
              <label style={labelStyle}>Descrição / contexto</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="Descreva o produto, épico ou feature a ser documentado…"
                style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
              />
            </div>
          </div>
          <div>
            <label style={labelStyle}>Documentos base</label>
            <UploadDropzone slug={slug || "default"} files={files} onChange={setFiles} />
          </div>
        </div>
      </div>

      {/* Fases */}
      <div style={{ maxWidth: "960px", margin: "0 auto", padding: "1.5rem" }}>
        {!slug ? (
          <p style={{ textAlign: "center", color: "#334155", marginTop: "4rem", fontSize: "0.9rem" }}>
            Preencha o slug do épico para começar.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {PHASES.map((phase, idx) => (
              <PhaseSection
                key={phase}
                phase={phase}
                slug={slug}
                description={description}
                files={files}
                previousPhases={PHASES.slice(0, idx)}
                isApproved={approvedPhases.has(phase)}
                isActive={phase === activePhase}
                isLocked={!approvedPhases.has(phase) && phase !== activePhase}
                onApproved={handleApproved}
              />
            ))}

            {allDone && (
              <div style={{
                textAlign: "center", padding: "2rem",
                border: "1px solid #1e3a28", borderRadius: "0.75rem",
                background: "#0d1a11", color: "#4ade80", fontSize: "0.9rem",
              }}>
                🎉 Pipeline completo! Artefatos em <code>.specs/features/{slug}/</code>
              </div>
            )}
          </div>
        )}
      </div>
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
  fontSize: "0.875rem", outline: "none", boxSizing: "border-box",
};
