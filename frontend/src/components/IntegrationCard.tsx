import { useEffect, useState } from "react";
import { friendlyError, getGithubPat, saveGithubPat } from "../lib/api";
import { useToast } from "./Toast";

const s = {
  bg: "#0f1117",
  surface: "#1e293b",
  border: "#1e293b",
  borderHover: "#334155",
  text: "#e2e8f0",
  muted: "#64748b",
  green: "#4ade80",
  amber: "#f59e0b",
  red: "#f87171",
  purple: "#7c3aed",
};

export function IntegrationCard() {
  const [pat, setPat] = useState("");
  const [masked, setMasked] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean>(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    getGithubPat()
      .then((data) => {
        setConfigured(data.configured);
        setMasked(data.configured ? data.masked : null);
      })
      .catch(() => {});
  }, []);

  async function handleSave() {
    if (!pat.trim()) return;
    setSaving(true);
    try {
      await saveGithubPat(pat.trim());
      const lastFour = pat.trim().slice(-4);
      setMasked("****" + lastFour);
      setConfigured(true);
      setPat("");
      setEditing(false);
      showToast("PAT do GitHub salvo", "success");
    } catch (e) {
      showToast(friendlyError(e), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        background: s.bg,
        border: `1px solid ${s.borderHover}`,
        borderRadius: 10,
        padding: "1.25rem 1.5rem",
        marginBottom: "1rem",
      }}
    >
      {/* Header: icon + title + status badge */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem", marginBottom: "1rem" }}>
        <div
          style={{
            background: s.surface,
            border: `1px solid ${s.borderHover}`,
            borderRadius: 8,
            padding: "0.4rem 0.5rem",
            fontSize: "1.1rem",
            lineHeight: 1,
            flexShrink: 0,
          }}
        >
          {/* Octocat-ish */}
          ⌥
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
            <h3 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 700, color: s.text }}>
              GitHub
            </h3>
            {configured ? (
              <span
                style={{
                  fontSize: "0.65rem",
                  fontWeight: 700,
                  color: s.green,
                  background: "#0d1a11",
                  border: `1px solid #1e3a28`,
                  padding: "1px 6px",
                  borderRadius: 4,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                ✓ Configurado
              </span>
            ) : (
              <span
                style={{
                  fontSize: "0.65rem",
                  fontWeight: 700,
                  color: s.amber,
                  background: "#1c1709",
                  border: `1px solid #7c5e10`,
                  padding: "1px 6px",
                  borderRadius: 4,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Não configurado
              </span>
            )}
          </div>
          <p style={{ margin: 0, fontSize: "0.78rem", color: s.muted, lineHeight: 1.5 }}>
            PAT pessoal usado pra clonar repositórios privados e listar repos no form de criação.
            Escopo necessário: <code style={{ color: s.muted, background: s.surface, padding: "0 4px", borderRadius: 3 }}>repo</code>
            {" "}(classic) ou{" "}
            <code style={{ color: s.muted, background: s.surface, padding: "0 4px", borderRadius: 3 }}>Contents: Read-only</code>
            {" "}(fine-grained).
          </p>
        </div>
      </div>

      {/* Body */}
      {configured && !editing ? (
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <code
            style={{
              flex: 1,
              background: s.surface,
              border: `1px solid ${s.borderHover}`,
              borderRadius: 6,
              padding: "8px 12px",
              fontSize: 13,
              color: s.text,
              fontFamily: "monospace",
            }}
          >
            {masked}
          </code>
          <button
            onClick={() => setEditing(true)}
            style={{
              background: "transparent",
              border: `1px solid ${s.borderHover}`,
              borderRadius: 6,
              color: s.text,
              padding: "8px 14px",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            Reconfigurar
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <input
            type="password"
            value={pat}
            onChange={(e) => setPat(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            placeholder="ghp_…"
            style={{
              background: s.surface,
              border: `1px solid ${s.borderHover}`,
              borderRadius: 6,
              color: s.text,
              padding: "8px 12px",
              fontSize: 13,
              outline: "none",
              fontFamily: "monospace",
            }}
          />
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              onClick={handleSave}
              disabled={saving || !pat.trim()}
              style={{
                background: saving || !pat.trim() ? s.surface : s.purple,
                color: saving || !pat.trim() ? s.muted : "#fff",
                border: "none",
                borderRadius: 6,
                padding: "8px 18px",
                fontSize: 12,
                fontWeight: 600,
                cursor: saving || !pat.trim() ? "not-allowed" : "pointer",
              }}
            >
              {saving ? "Salvando…" : "Salvar"}
            </button>
            {editing && (
              <button
                onClick={() => {
                  setEditing(false);
                  setPat("");
                }}
                style={{
                  background: "transparent",
                  border: `1px solid ${s.borderHover}`,
                  borderRadius: 6,
                  color: s.muted,
                  padding: "8px 14px",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                Cancelar
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
