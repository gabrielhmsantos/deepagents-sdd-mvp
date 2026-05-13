import { useRef, useState } from "react";

interface ExecEntry {
  cmd: string;
  output: string;
  exitCode: number;
  ts: string;
}

interface Props {
  slug: string;
  repoPath: string | null;
  isOpen: boolean;
  onToggle: () => void;
}

const c = {
  bg: "#0a0e17",
  surface: "#1e293b",
  border: "#334155",
  text: "#e2e8f0",
  muted: "#64748b",
  purple: "#7c3aed",
  green: "#4ade80",
  red: "#f87171",
  amber: "#f59e0b",
};

export function TerminalPanel({ slug, repoPath, isOpen, onToggle }: Props) {
  const [command, setCommand] = useState(repoPath ? `ls ${repoPath}` : "ls /");
  const [history, setHistory] = useState<ExecEntry[]>([]);
  const [isExecuting, setIsExecuting] = useState(false);
  const terminalRef = useRef<HTMLDivElement>(null);

  async function handleExec() {
    if (!command.trim() || isExecuting) return;
    setIsExecuting(true);
    const ts = new Date().toLocaleTimeString();
    try {
      const res = await fetch(`/api/sandboxes/${slug}/exec`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json() as { output: string; exit_code: number };
      setHistory((h) => [...h, { cmd: command, output: data.output, exitCode: data.exit_code, ts }]);
    } catch (e) {
      setHistory((h) => [...h, { cmd: command, output: String(e), exitCode: -1, ts }]);
    } finally {
      setIsExecuting(false);
      setTimeout(() => terminalRef.current?.scrollTo({ top: 99999, behavior: "smooth" }), 50);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleExec(); }
  }

  const quickCommands = repoPath
    ? [
        `ls ${repoPath}`,
        `find ${repoPath} -name '*.py' | head -20`,
        `find ${repoPath} -name 'package.json' | head -5`,
        `cat ${repoPath}/README.md`,
      ]
    : ["ls $HOME", "python3 --version", "node --version", "echo $HOME"];

  return (
    <div style={{ border: `1px solid ${c.border}`, borderRadius: "0.625rem", overflow: "hidden" }}>
      {/* Toggle header — markdown-like */}
      <button
        onClick={onToggle}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          width: "100%",
          background: "#0d1117",
          border: "none",
          borderBottom: isOpen ? `1px solid ${c.border}` : "none",
          padding: "0.6rem 1rem",
          cursor: "pointer",
          textAlign: "left",
          color: c.muted,
          fontFamily: "monospace",
          fontSize: "0.8rem",
        }}
      >
        <span style={{ color: c.green, fontSize: "0.7rem" }}>{isOpen ? "▼" : "▶"}</span>
        <span style={{ color: c.muted }}>Terminal</span>
        {repoPath && (
          <span style={{ color: c.border, marginLeft: 2 }}>
            — <span style={{ color: "#4ade8077" }}>{repoPath}</span>
          </span>
        )}
        {history.length > 0 && (
          <span style={{ marginLeft: "auto", color: c.border, fontSize: "0.7rem" }}>
            {history.length} cmd{history.length !== 1 ? "s" : ""}
          </span>
        )}
      </button>

      {isOpen && (
        <div style={{ background: c.bg }}>
          {/* Output */}
          <div
            ref={terminalRef}
            style={{
              minHeight: 180,
              maxHeight: 320,
              overflowY: "auto",
              padding: "0.75rem 1rem",
              fontFamily: "monospace",
              fontSize: 13,
              lineHeight: 1.6,
            }}
          >
            {history.length === 0 && (
              <span style={{ color: c.muted }}># sandbox pronto. execute um comando abaixo.</span>
            )}
            {history.map((entry, i) => (
              <div key={i} style={{ marginBottom: 12 }}>
                <div style={{ color: c.green }}>
                  <span style={{ color: c.muted, fontSize: 11, marginRight: 8 }}>{entry.ts}</span>
                  $ {entry.cmd}
                </div>
                <pre style={{
                  margin: "2px 0 0 0", whiteSpace: "pre-wrap", wordBreak: "break-all",
                  color: entry.exitCode === 0 ? c.text : c.red,
                }}>
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

          {/* Command input */}
          <div style={{
            borderTop: `1px solid ${c.border}`,
            padding: "0.5rem 1rem",
            display: "flex", gap: 8, alignItems: "center",
          }}>
            <span style={{ color: c.green, fontFamily: "monospace", fontSize: 14 }}>$</span>
            <input
              style={{
                flex: 1, background: "transparent", border: "none",
                color: c.text, fontFamily: "monospace", fontSize: 13,
                outline: "none",
              }}
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="ls /repo"
              disabled={isExecuting}
            />
            <button
              onClick={handleExec}
              disabled={isExecuting}
              style={{
                background: isExecuting ? c.surface : c.purple,
                color: isExecuting ? c.muted : "#fff",
                border: "none", borderRadius: 6,
                padding: "5px 14px", fontSize: 12, fontWeight: 600,
                cursor: isExecuting ? "not-allowed" : "pointer",
              }}
            >
              {isExecuting ? "…" : "Run"}
            </button>
          </div>

          {/* Quick commands */}
          <div style={{
            borderTop: `1px solid ${c.border}`,
            padding: "0.5rem 1rem",
            display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center",
          }}>
            <span style={{ fontSize: 11, color: c.muted, flexShrink: 0 }}>Atalhos:</span>
            {quickCommands.map((cmd) => (
              <button
                key={cmd}
                onClick={() => setCommand(cmd)}
                style={{
                  background: "transparent", border: `1px solid ${c.border}`,
                  borderRadius: 4, color: c.muted,
                  padding: "2px 8px", fontSize: 11,
                  fontFamily: "monospace", cursor: "pointer",
                  whiteSpace: "nowrap", maxWidth: 220,
                  overflow: "hidden", textOverflow: "ellipsis",
                }}
                title={cmd}
              >
                {cmd}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
