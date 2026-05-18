import { useEffect, useRef, useState } from "react";
import { listGithubRepos } from "../lib/api";
import type { GithubRepo } from "../lib/types";

export interface RepoSelection {
  owner: string;
  name: string;
  default_branch: string;
}

interface Props {
  value: RepoSelection | null;
  onChange: (sel: RepoSelection | null) => void;
  onOpenSettings: () => void;
}

const s = {
  bg: "#0f1117",
  surface: "#1e293b",
  border: "#334155",
  text: "#e2e8f0",
  muted: "#64748b",
  amber: "#f59e0b",
  red: "#f87171",
};

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; repos: GithubRepo[] }
  | { kind: "no_pat" }
  | { kind: "error"; message: string };

export function RepoPicker({ value, onChange, onOpenSettings }: Props) {
  const [state, setState] = useState<LoadState>({ kind: "idle" });
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch repos on first open (lazy — não desperdiça call se user nem abrir).
  useEffect(() => {
    if (!open || state.kind !== "idle") return;
    setState({ kind: "loading" });
    listGithubRepos()
      .then((repos) => setState({ kind: "loaded", repos }))
      .catch((err: Error) => {
        const msg = err.message || "";
        if (msg.includes("400") && msg.toLowerCase().includes("pat")) {
          setState({ kind: "no_pat" });
        } else {
          setState({ kind: "error", message: msg });
        }
      });
  }, [open, state.kind]);

  // Click outside closes.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);

  const filtered =
    state.kind === "loaded"
      ? state.repos.filter((r) => {
          const q = filter.toLowerCase().trim();
          if (!q) return true;
          return (
            r.name.toLowerCase().includes(q) ||
            r.owner.toLowerCase().includes(q) ||
            `${r.owner}/${r.name}`.toLowerCase().includes(q)
          );
        })
      : [];

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          textAlign: "left",
          background: s.bg,
          border: `1px solid ${s.border}`,
          borderRadius: 6,
          padding: "8px 12px",
          color: value ? s.text : s.muted,
          fontSize: 13,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.5rem",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {value ? `${value.owner}/${value.name}` : "Escolher repositório do GitHub…"}
        </span>
        <span style={{ color: s.muted, fontSize: 11 }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            background: s.bg,
            border: `1px solid ${s.border}`,
            borderRadius: 6,
            maxHeight: 320,
            display: "flex",
            flexDirection: "column",
            zIndex: 20,
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
          }}
        >
          {state.kind === "loading" && (
            <p style={{ padding: "1rem", color: s.muted, fontSize: 13, margin: 0 }}>
              Carregando repos…
            </p>
          )}

          {state.kind === "no_pat" && (
            <div style={{ padding: "1rem" }}>
              <p style={{ color: s.amber, fontSize: 13, margin: "0 0 0.75rem" }}>
                ⚠ GitHub PAT não configurado.
              </p>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onOpenSettings();
                }}
                style={{
                  background: "transparent",
                  border: `1px solid ${s.border}`,
                  borderRadius: 4,
                  color: s.text,
                  padding: "4px 10px",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                Configurar no Settings →
              </button>
            </div>
          )}

          {state.kind === "error" && (
            <p style={{ padding: "1rem", color: s.red, fontSize: 12, margin: 0 }}>
              Erro: {state.message}
            </p>
          )}

          {state.kind === "loaded" && (
            <>
              <div style={{ padding: "0.5rem", borderBottom: `1px solid ${s.border}` }}>
                <input
                  type="text"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filtrar…"
                  autoFocus
                  style={{
                    width: "100%",
                    background: s.surface,
                    border: `1px solid ${s.border}`,
                    borderRadius: 4,
                    color: s.text,
                    padding: "6px 10px",
                    fontSize: 12,
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
              </div>
              <div style={{ overflowY: "auto", flex: 1 }}>
                {filtered.length === 0 ? (
                  <p style={{ padding: "0.75rem", color: s.muted, fontSize: 12, margin: 0 }}>
                    Nenhum repo encontrado.
                  </p>
                ) : (
                  filtered.map((r) => (
                    <button
                      key={`${r.owner}/${r.name}`}
                      type="button"
                      onClick={() => {
                        onChange({
                          owner: r.owner,
                          name: r.name,
                          default_branch: r.default_branch,
                        });
                        setOpen(false);
                        setFilter("");
                      }}
                      style={{
                        display: "block",
                        width: "100%",
                        textAlign: "left",
                        background: "transparent",
                        border: "none",
                        borderBottom: `1px solid ${s.surface}`,
                        color: s.text,
                        padding: "8px 12px",
                        cursor: "pointer",
                        fontSize: 12,
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = s.surface)}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <div style={{ fontWeight: 600 }}>
                        {r.owner}/{r.name}
                        {r.private && (
                          <span style={{ marginLeft: 6, fontSize: 10, color: s.muted }}>
                            🔒 private
                          </span>
                        )}
                      </div>
                      <div style={{ color: s.muted, fontSize: 11, marginTop: 2 }}>
                        branch: {r.default_branch}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      )}

      {value && (
        <button
          type="button"
          onClick={() => onChange(null)}
          style={{
            marginTop: 6,
            background: "transparent",
            border: "none",
            color: s.muted,
            fontSize: 11,
            cursor: "pointer",
            textDecoration: "underline",
            padding: 0,
          }}
        >
          Limpar seleção (greenfield)
        </button>
      )}
    </div>
  );
}
