import { useCallback, useEffect, useRef, useState } from "react";
import { listArtifacts, zipUrl } from "./lib/api";
import { PHASES, PHASE_LABELS } from "./lib/types";
import type { Phase, UploadedFile } from "./lib/types";
import { PhaseSection } from "./components/PhaseSection";
import { SandboxCard } from "./components/SandboxCard";
import type { SandboxStatus } from "./components/SandboxCard";
import { SettingsSidebar } from "./components/SettingsSidebar";
import { TerminalPanel } from "./components/TerminalPanel";
import { UploadDropzone } from "./components/UploadDropzone";

// Feature flags (build-time, Vite)
const POLL_ENABLED = import.meta.env.VITE_SANDBOX_POLL_ENABLED !== "false";
const POLL_INTERVAL_MS = Number(import.meta.env.VITE_SANDBOX_POLL_INTERVAL_MS) || 60_000;

async function fetchSandboxStatus(slug: string): Promise<{ status: SandboxStatus; repoPath: string | null }> {
  try {
    const r = await fetch(`/api/sandboxes/${slug}`);
    if (!r.ok) return { status: "idle", repoPath: null };
    const data = (await r.json()) as {
      exists: boolean;
      status: string;
      repo_path?: string | null;
    };
    if (!data.exists) return { status: "idle", repoPath: null };
    const status: SandboxStatus = data.status === "restarting" ? "restarting" : "ready";
    return { status, repoPath: data.repo_path ?? null };
  } catch {
    return { status: "idle", repoPath: null };
  }
}

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

// ── Debounce ──────────────────────────────────────────────────────────────────
function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setDebounced(value), delay);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [value, delay]);
  return debounced;
}

// ── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [slugInput, setSlugInput] = useState(() => {
    try { return JSON.parse(localStorage.getItem("champion-slug") ?? '""') as string; } catch { return ""; }
  });
  const [descriptionInput, setDescriptionInput] = useState(() => {
    try { return JSON.parse(localStorage.getItem("champion-description") ?? '""') as string; } catch { return ""; }
  });
  const [files, setFiles] = useLocalStorage<UploadedFile[]>("champion-files", []);

  const slug = useDebounced(slugInput.toLowerCase().replace(/\s+/g, "-"), 300);
  const description = useDebounced(descriptionInput, 400);

  useEffect(() => { try { localStorage.setItem("champion-slug", JSON.stringify(slug)); } catch {} }, [slug]);
  useEffect(() => { try { localStorage.setItem("champion-description", JSON.stringify(description)); } catch {} }, [description]);

  const [approvedPhases, setApprovedPhases] = useState<Set<Phase>>(new Set());
  const [phasesDirty, setPhasesDirty] = useState(0);
  const [sandboxStatus, setSandboxStatus] = useState<SandboxStatus>("idle");
  const [repoPath, setRepoPath] = useState<string | null>(null);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const sandboxReady = sandboxStatus === "ready";

  // Sincroniza fases aprovadas
  useEffect(() => {
    if (!slug || slug.length < 3) { setApprovedPhases(new Set()); return; }
    listArtifacts(slug)
      .then((phases) => setApprovedPhases(new Set(phases.map((p) => p.toLowerCase() as Phase))))
      .catch(() => setApprovedPhases(new Set()));
  }, [slug, phasesDirty]);

  // Verifica sandbox ao mudar de slug
  useEffect(() => {
    if (!slug || slug.length < 3) {
      setSandboxStatus("idle");
      setRepoPath(null);
      return;
    }
    fetchSandboxStatus(slug).then(({ status, repoPath: rp }) => {
      setSandboxStatus(status);
      setRepoPath(rp);
    });
  }, [slug]);

  // Polling de saúde (feature flag)
  useEffect(() => {
    if (!POLL_ENABLED || !slug || slug.length < 3) return;
    const id = setInterval(() => {
      fetchSandboxStatus(slug).then(({ status, repoPath: rp }) => {
        setSandboxStatus(status);
        if (rp) setRepoPath(rp);
      });
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [slug]);

  const handleApproved = useCallback(() => setPhasesDirty((n) => n + 1), []);

  const handleTerminateSandbox = useCallback(async () => {
    if (!slug) return;
    try {
      await fetch(`/api/sandboxes/${slug}`, { method: "DELETE" });
      setSandboxStatus("idle");
      setRepoPath(null);
      setTerminalOpen(false);
    } catch {}
  }, [slug]);

  const handleSandboxReady = useCallback((rp: string | null) => {
    setSandboxStatus("ready");
    setRepoPath(rp);
    setTerminalOpen(true); // abre terminal automaticamente ao criar sandbox
  }, []);

  const activePhase = PHASES.find((p) => !approvedPhases.has(p));
  const allDone = approvedPhases.size === PHASES.length;

  return (
    <div style={{ minHeight: "100vh", background: "#0a0d14", color: "#e2e8f0", fontFamily: "system-ui, sans-serif", display: "flex" }}>
      <SettingsSidebar />

      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>

        {/* Cabeçalho */}
        <header style={{
          height: "48px", display: "flex", alignItems: "center",
          padding: "0 1.5rem", gap: "0.75rem",
          borderBottom: "1px solid #1e293b", background: "#0f1117",
          flexShrink: 0,
        }}>
          <span style={{ color: "#7c3aed", fontWeight: 700, fontSize: "0.9rem" }}>Champion AI</span>
          <span style={{ color: "#334155", fontSize: "0.8rem" }}>SDD Studio</span>
          {slug && (
            <>
              <span style={{ color: "#1e293b" }}>·</span>
              <span style={{ color: "#64748b", fontSize: "0.8rem" }}>{slug}</span>
            </>
          )}
          <div style={{ marginLeft: "auto", display: "flex", gap: "0.5rem", alignItems: "center" }}>
            {sandboxReady && (
              <button
                onClick={handleTerminateSandbox}
                style={{
                  background: "transparent", border: "1px solid #7f1d1d",
                  borderRadius: 6, color: "#f87171",
                  padding: "4px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer",
                }}
              >
                Encerrar sandbox
              </button>
            )}
            <div style={{ display: "flex", gap: "0.35rem", alignItems: "center" }}>
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
          </div>
        </header>

        {/* Formulário compartilhado */}
        <div style={{ borderBottom: "1px solid #1e293b", background: "#0f1117", padding: "1.25rem 1.5rem", flexShrink: 0 }}>
          <div style={{ maxWidth: "960px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div style={{ display: "flex", gap: "1rem", alignItems: "flex-start", flexWrap: "wrap" }}>
              <div style={{ flex: "0 0 220px" }}>
                <label style={labelStyle}>Slug do épico</label>
                <input
                  value={slugInput}
                  onChange={(e) => setSlugInput(e.target.value)}
                  placeholder="ex: seconci-app"
                  style={inputStyle}
                />
              </div>
              <div style={{ flex: 1, minWidth: "200px" }}>
                <label style={labelStyle}>Descrição / contexto</label>
                <textarea
                  value={descriptionInput}
                  onChange={(e) => setDescriptionInput(e.target.value)}
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

        {/* Conteúdo principal: sandbox + terminal + fases */}
        <div style={{ maxWidth: "960px", margin: "0 auto", padding: "1.5rem", width: "100%" }}>
          {!slug ? (
            <p style={{ textAlign: "center", color: "#334155", marginTop: "4rem", fontSize: "0.9rem" }}>
              Preencha o slug do épico para começar.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>

              {/* Card de criação/status do sandbox */}
              {!sandboxReady && (
                <SandboxCard slug={slug} status={sandboxStatus} onReady={handleSandboxReady} />
              )}

              {/* Terminal colapsável — só quando sandbox está ativo */}
              {sandboxReady && (
                <TerminalPanel
                  slug={slug}
                  repoPath={repoPath}
                  isOpen={terminalOpen}
                  onToggle={() => setTerminalOpen((v) => !v)}
                />
              )}

              {/* Fases de geração de artefatos
                  Key inclui o slug: ao trocar de slug, PhaseSection desmonta e
                  remonta, descartando state stale (mode, draft, pendingInput,
                  streamKey, approvedContent). Sem isso, o usuário vê "Aprovar"
                  e "Re-gerar" do slug anterior em um slug novo que nunca gerou. */}
              {PHASES.map((phase) => (
                <PhaseSection
                  key={`${phase}::${slug}`}
                  phase={phase}
                  slug={slug}
                  description={description}
                  files={files}
                  isApproved={approvedPhases.has(phase)}
                  isActive={phase === activePhase}
                  isLocked={!approvedPhases.has(phase) && phase !== activePhase}
                  sandboxReady={sandboxReady}
                  onApproved={handleApproved}
                />
              ))}

              {allDone && (
                <div style={{
                  textAlign: "center", padding: "2rem",
                  border: "1px solid #1e3a28", borderRadius: "0.75rem",
                  background: "#0d1a11", color: "#4ade80", fontSize: "0.9rem",
                  display: "flex", flexDirection: "column", gap: "1rem", alignItems: "center",
                }}>
                  <div>🎉 Pipeline completo! Artefatos em <code>.specs/features/{slug}/</code></div>
                  <a
                    href={zipUrl(slug)}
                    download
                    style={{
                      display: "inline-block",
                      padding: "0.65rem 1.5rem",
                      background: "#22c55e",
                      color: "#052e16",
                      fontWeight: 700,
                      borderRadius: "0.5rem",
                      textDecoration: "none",
                      fontSize: "0.9rem",
                    }}
                  >
                    ↓ Baixar pacote ZIP (5 artefatos + manifest + repo-tree)
                  </a>
                </div>
              )}
            </div>
          )}
        </div>

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
