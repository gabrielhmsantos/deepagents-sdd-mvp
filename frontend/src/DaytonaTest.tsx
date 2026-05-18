import { useRef, useState } from "react";
import { cancelSandbox, ensureSandbox } from "./lib/api";

// Exec ainda usa /api/sandboxes/{slug}/exec — operação pós-criação, fora do
// escopo do lifecycle (/ensure cuida só do ciclo create/start/recreate/delete).
const EXEC_API = "/api/sandboxes";

interface ExecEntry {
  cmd: string;
  output: string;
  exitCode: number;
  ts: string;
}

const c = {
  bg: "#0f1117",
  surface: "#1e293b",
  border: "#334155",
  text: "#e2e8f0",
  muted: "#64748b",
  purple: "#7c3aed",
  green: "#4ade80",
  red: "#f87171",
  amber: "#f59e0b",
};

const input: React.CSSProperties = {
  background: "#0f1117",
  border: `1px solid ${c.border}`,
  borderRadius: 6,
  color: c.text,
  padding: "8px 12px",
  fontSize: 14,
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

const btn = (color: string, disabled = false): React.CSSProperties => ({
  background: disabled ? "#1e293b" : color,
  color: disabled ? c.muted : "#fff",
  border: "none",
  borderRadius: 6,
  padding: "8px 18px",
  fontSize: 13,
  fontWeight: 600,
  cursor: disabled ? "not-allowed" : "pointer",
  whiteSpace: "nowrap",
});

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    idle: [c.muted, "idle"],
    creating: [c.amber, "criando…"],
    ready: [c.green, "pronto"],
    error: [c.red, "erro"],
  };
  const [color, label] = map[status] ?? [c.muted, status];
  return (
    <span
      style={{
        background: color + "22",
        color,
        border: `1px solid ${color}55`,
        borderRadius: 99,
        padding: "2px 10px",
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      {label}
    </span>
  );
}

export default function DaytonaTest({ onBack }: { onBack: () => void }) {
  const [slug, setSlug] = useState("daytona-test");
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [sandboxId, setSandboxId] = useState<string | null>(null);
  const [repoPath, setRepoPath] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "creating" | "ready" | "error">("idle");
  const [command, setCommand] = useState("ls /");
  const [history, setHistory] = useState<ExecEntry[]>([]);
  const [isExecuting, setIsExecuting] = useState(false);
  const terminalRef = useRef<HTMLDivElement>(null);

  async function handleCreate() {
    if (!slug) return;
    setStatus("creating");
    setSandboxId(null);
    setRepoPath(null);
    setHistory([]);
    try {
      const data = await ensureSandbox(slug, {
        repo_url: repoUrl || null,
        branch,
      });
      setSandboxId(data.sandbox_id);
      setRepoPath(data.repo_path);
      setStatus("ready");
    } catch (e) {
      console.error(e);
      setHistory([{ cmd: "criar sandbox", output: String(e), exitCode: -1, ts: new Date().toLocaleTimeString() }]);
      setStatus("error");
    }
  }

  async function handleDelete() {
    if (!slug) return;
    try {
      await cancelSandbox(slug);
    } catch {
      // ignora se não existia
    }
    setSandboxId(null);
    setRepoPath(null);
    setStatus("idle");
    setHistory([]);
  }

  async function handleExec() {
    if (!command.trim() || status !== "ready") return;
    setIsExecuting(true);
    const ts = new Date().toLocaleTimeString();
    try {
      const res = await fetch(`${EXEC_API}/${slug}/exec`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setHistory((h) => [...h, { cmd: command, output: data.output, exitCode: data.exit_code, ts }]);
    } catch (e) {
      setHistory((h) => [
        ...h,
        { cmd: command, output: String(e), exitCode: -1, ts },
      ]);
    } finally {
      setIsExecuting(false);
      setTimeout(() => terminalRef.current?.scrollTo({ top: 99999, behavior: "smooth" }), 50);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleExec();
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: c.bg, color: c.text, fontFamily: "system-ui, sans-serif" }}>
      {/* header */}
      <div
        style={{
          borderBottom: `1px solid ${c.border}`,
          padding: "14px 24px",
          display: "flex",
          alignItems: "center",
          gap: 16,
        }}
      >
        <button onClick={onBack} style={{ ...btn(c.surface), border: `1px solid ${c.border}`, fontSize: 13 }}>
          ← voltar
        </button>
        <span style={{ fontWeight: 700, fontSize: 16 }}>Daytona Sandbox — teste</span>
        <StatusBadge status={status} />
        <div style={{ marginLeft: "auto", display: "flex", gap: 12, alignItems: "center" }}>
          {repoPath && (
            <span style={{ fontFamily: "monospace", fontSize: 12, color: c.green }}>
              repo: {repoPath}
            </span>
          )}
          {sandboxId && (
            <span style={{ color: c.muted, fontSize: 12 }}>
              ID: {sandboxId}
            </span>
          )}
        </div>
      </div>

      <div style={{ maxWidth: 860, margin: "0 auto", padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>

        {/* config card */}
        <div style={{ background: c.surface, border: `1px solid ${c.border}`, borderRadius: 10, padding: 20 }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 16, color: c.muted, textTransform: "uppercase", letterSpacing: 1 }}>
            Configuração do Sandbox
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: c.muted, display: "block", marginBottom: 4 }}>Slug</label>
              <input
                style={input}
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/\s+/g, "-"))}
                placeholder="meu-projeto"
                disabled={status === "ready" || status === "creating"}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: c.muted, display: "block", marginBottom: 4 }}>
                URL do repositório <span style={{ opacity: 0.5 }}>(opcional)</span>
              </label>
              <input
                style={input}
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="https://github.com/org/repo"
                disabled={status === "ready" || status === "creating"}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: c.muted, display: "block", marginBottom: 4 }}>Branch</label>
              <input
                style={input}
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                placeholder="main"
                disabled={status === "ready" || status === "creating"}
              />
            </div>
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button
              style={btn(c.purple, status === "creating" || status === "ready")}
              disabled={status === "creating" || status === "ready"}
              onClick={handleCreate}
            >
              {status === "creating" ? "Criando…" : "Criar sandbox"}
            </button>
            <button
              style={btn("#475569", status === "idle" || status === "creating")}
              disabled={status === "idle" || status === "creating"}
              onClick={handleDelete}
            >
              Destruir sandbox
            </button>
          </div>
        </div>

        {/* terminal */}
        <div style={{ background: "#0a0e17", border: `1px solid ${c.border}`, borderRadius: 10, overflow: "hidden" }}>
          <div
            style={{
              padding: "10px 16px",
              borderBottom: `1px solid ${c.border}`,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#ef4444", display: "inline-block" }} />
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: c.amber, display: "inline-block" }} />
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: c.green, display: "inline-block" }} />
            <span style={{ fontSize: 12, color: c.muted, marginLeft: 8 }}>
              {sandboxId ? `sandbox: ${slug}` : "aguardando sandbox…"}
            </span>
          </div>

          {/* output */}
          <div
            ref={terminalRef}
            style={{
              minHeight: 320,
              maxHeight: 480,
              overflowY: "auto",
              padding: 16,
              fontFamily: "monospace",
              fontSize: 13,
              lineHeight: 1.6,
            }}
          >
            {history.length === 0 && (
              <span style={{ color: c.muted }}>
                {status === "ready"
                  ? "# sandbox pronto. execute um comando abaixo."
                  : "# crie um sandbox para começar."}
              </span>
            )}
            {history.map((entry, i) => (
              <div key={i} style={{ marginBottom: 16 }}>
                <div style={{ color: c.green }}>
                  <span style={{ color: c.muted, fontSize: 11, marginRight: 8 }}>{entry.ts}</span>
                  $ {entry.cmd}
                </div>
                <pre
                  style={{
                    margin: "4px 0 0 0",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all",
                    color: entry.exitCode === 0 ? c.text : c.red,
                  }}
                >
                  {entry.output || "(sem output)"}
                </pre>
                {entry.exitCode !== 0 && (
                  <span style={{ fontSize: 11, color: c.red }}>exit {entry.exitCode}</span>
                )}
              </div>
            ))}
            {isExecuting && (
              <div style={{ color: c.amber }}>$ {command} <span style={{ opacity: 0.6 }}>…</span></div>
            )}
          </div>

          {/* command input */}
          <div
            style={{
              borderTop: `1px solid ${c.border}`,
              padding: "10px 16px",
              display: "flex",
              gap: 10,
              alignItems: "center",
            }}
          >
            <span style={{ color: c.green, fontFamily: "monospace", fontSize: 14 }}>$</span>
            <input
              style={{ ...input, border: "none", background: "transparent", flex: 1, fontFamily: "monospace" }}
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="ls /repo"
              disabled={status !== "ready" || isExecuting}
            />
            <button
              style={btn(c.purple, status !== "ready" || isExecuting)}
              disabled={status !== "ready" || isExecuting}
              onClick={handleExec}
            >
              {isExecuting ? "…" : "Executar"}
            </button>
          </div>
        </div>

        {/* quick commands */}
        {status === "ready" && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: c.muted, alignSelf: "center" }}>Atalhos:</span>
            {[
              repoPath ? `ls ${repoPath}` : "ls $HOME",
              repoPath ? `find ${repoPath} -name '*.py' | head -20` : "echo $HOME",
              repoPath ? `find ${repoPath} -name 'package.json' | head -5` : "python3 --version",
              repoPath ? `cat ${repoPath}/README.md` : "ls /tmp",
              "python3 --version",
            ].map((cmd) => (
              <button
                key={cmd}
                onClick={() => setCommand(cmd)}
                style={{
                  background: "transparent",
                  border: `1px solid ${c.border}`,
                  borderRadius: 6,
                  color: c.muted,
                  padding: "4px 10px",
                  fontSize: 12,
                  fontFamily: "monospace",
                  cursor: "pointer",
                }}
              >
                {cmd}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
