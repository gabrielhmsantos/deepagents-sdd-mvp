import { useState } from "react";

export type SandboxStatus = "idle" | "restarting" | "ready";

interface Props {
  slug: string;
  status: Exclude<SandboxStatus, "ready">;
  onReady: (repoPath: string | null) => void;
}

const s = {
  surface: "#1e293b",
  border: "#334155",
  text: "#e2e8f0",
  muted: "#64748b",
  purple: "#7c3aed",
  amber: "#f59e0b",
  red: "#f87171",
};

const inputStyle: React.CSSProperties = {
  background: "#0f1117",
  border: `1px solid ${s.border}`,
  borderRadius: 6,
  color: s.text,
  padding: "8px 12px",
  fontSize: 13,
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

export function SandboxCard({ slug, status, onReady }: Props) {
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function handleCreate() {
    setError("");
    setIsLoading(true);
    try {
      const res = await fetch(`/api/sandboxes/${slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo_url: repoUrl.trim() || null, branch: branch.trim() || "main" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ detail: res.statusText })) as { detail?: string };
        throw new Error(data.detail ?? res.statusText);
      }
      const data = await res.json() as { repo_path?: string | null };
      onReady(data.repo_path ?? null);
    } catch (e) {
      setError(String(e));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div style={{
      border: `1px solid ${status === "restarting" ? s.amber + "55" : s.border}`,
      borderRadius: "0.625rem",
      background: "#0d1117",
      padding: "1rem 1.25rem",
      display: "flex",
      flexDirection: "column",
      gap: "0.75rem",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <span style={{ fontSize: "0.75rem", fontWeight: 600, color: s.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Sandbox Daytona
        </span>
        {status === "restarting" && <span style={{ fontSize: "0.75rem", color: s.amber }}>⏳ Reiniciando container…</span>}
        {status === "idle" && <span style={{ fontSize: "0.75rem", color: s.muted }}>Necessário para gerar artefatos</span>}
      </div>

      {status === "restarting" ? (
        <p style={{ fontSize: "0.8rem", color: s.muted, margin: 0 }}>
          O sandbox está sendo reativado. A página se atualizará automaticamente.
        </p>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "0.75rem" }}>
            <div>
              <label style={labelStyle}>URL do repositório <span style={{ opacity: 0.5 }}>(opcional)</span></label>
              <input
                style={inputStyle}
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                placeholder="https://github.com/org/repo"
                disabled={isLoading}
              />
            </div>
            <div>
              <label style={labelStyle}>Branch</label>
              <input
                style={inputStyle}
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                placeholder="main"
                disabled={isLoading}
              />
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <button
              onClick={handleCreate}
              disabled={isLoading}
              style={{
                background: isLoading ? s.surface : s.purple,
                color: isLoading ? s.muted : "#fff",
                border: "none", borderRadius: 6,
                padding: "8px 20px", fontSize: 13, fontWeight: 600,
                cursor: isLoading ? "not-allowed" : "pointer",
              }}
            >
              {isLoading ? "Criando…" : "Criar sandbox"}
            </button>
            {error && <span style={{ fontSize: "0.78rem", color: s.red }}>{error}</span>}
          </div>
        </>
      )}
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block", fontSize: "0.73rem", color: s.muted,
  marginBottom: "0.3rem", fontWeight: 500,
};
