import { useEffect, useRef, useState } from "react";
import { getGithubPat, saveGithubPat } from "../lib/api";

export function SettingsSidebar() {
  const [pat, setPat] = useState("");
  const [masked, setMasked] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    getGithubPat()
      .then((data) => setMasked(data.configured ? data.masked : null))
      .catch(() => {});
  }, []);

  async function handleSave() {
    if (!pat.trim()) return;
    setSaving(true);
    try {
      await saveGithubPat(pat.trim());
      const lastFour = pat.trim().slice(-4);
      setMasked("****" + lastFour);
      setPat("");
      setSavedAt(Date.now());
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setSavedAt(null), 2000);
    } catch {
      // ignorar — usuário pode tentar novamente
    } finally {
      setSaving(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") handleSave();
  }

  return (
    <aside
      style={{
        width: "240px",
        flexShrink: 0,
        borderRight: "1px solid #1e293b",
        background: "#0f1117",
        display: "flex",
        flexDirection: "column",
        padding: "1.25rem 1rem",
        gap: "1.25rem",
        overflowY: "auto",
      }}
    >
      <div>
        <span
          style={{
            display: "block",
            fontSize: "0.68rem",
            fontWeight: 700,
            letterSpacing: "0.08em",
            color: "#334155",
            textTransform: "uppercase",
            marginBottom: "0.85rem",
          }}
        >
          Configurações
        </span>

        <label style={labelStyle}>GitHub PAT</label>
        <input
          type="password"
          value={pat}
          onChange={(e) => setPat(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={masked ?? "ghp_…"}
          style={inputStyle}
        />
        <span
          style={{
            display: "block",
            fontSize: "0.7rem",
            color: "#475569",
            marginTop: "0.35rem",
            lineHeight: 1.4,
          }}
        >
          Escopo: <code style={{ color: "#64748b" }}>repo</code> (classic) ou{" "}
          <code style={{ color: "#64748b" }}>Contents: Read-only</code> (fine-grained)
        </span>

        <button
          onClick={handleSave}
          disabled={saving || !pat.trim()}
          style={{
            marginTop: "0.65rem",
            width: "100%",
            background: saving || !pat.trim() ? "#1e293b" : "#7c3aed",
            color: saving || !pat.trim() ? "#475569" : "#fff",
            border: "none",
            borderRadius: "0.375rem",
            padding: "0.45rem 0",
            fontSize: "0.8rem",
            fontWeight: 600,
            cursor: saving || !pat.trim() ? "not-allowed" : "pointer",
          }}
        >
          {savedAt ? "✓ Salvo" : saving ? "Salvando…" : "Salvar"}
        </button>

        {masked && !pat && (
          <span style={{ display: "block", fontSize: "0.7rem", color: "#4ade80", marginTop: "0.5rem" }}>
            PAT configurado: {masked}
          </span>
        )}
      </div>
    </aside>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.75rem",
  color: "#64748b",
  marginBottom: "0.35rem",
  fontWeight: 500,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "#1e293b",
  border: "1px solid #334155",
  borderRadius: "0.375rem",
  color: "#e2e8f0",
  padding: "0.45rem 0.6rem",
  fontSize: "0.8rem",
  outline: "none",
  boxSizing: "border-box",
};
