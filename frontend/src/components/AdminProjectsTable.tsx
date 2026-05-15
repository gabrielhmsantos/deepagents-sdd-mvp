import { useCallback, useEffect, useMemo, useState } from "react";
import { cancelSandbox, deleteProject, friendlyError, listAdminProjects } from "../lib/api";
import type { AdminProjectRow } from "../lib/types";
import { PHASES, PHASE_LABELS } from "../lib/types";
import { ConfirmModal } from "./ConfirmModal";
import { useToast } from "./Toast";

interface Props {
  onProjectsChanged: () => void;
}

const s = {
  bg: "#0f1117",
  surface: "#1e293b",
  surfaceHover: "#171c26",
  border: "#1e293b",
  borderHover: "#334155",
  text: "#e2e8f0",
  muted: "#64748b",
  green: "#4ade80",
  amber: "#f59e0b",
  red: "#f87171",
  blue: "#60a5fa",
  gray: "#1e293b",
};

type StatusFilter = "all" | "active" | "cancelled" | "deleted" | "completed" | "idle";
type ConfirmState = { type: "cancel" | "delete"; slug: string } | null;

function statusColor(status: string | null): string {
  if (!status) return s.muted;
  switch (status) {
    case "active":
      return s.green;
    case "completed":
      return s.blue;
    case "cancelled":
      return s.amber;
    case "deleted":
      return s.red;
    default:
      return s.muted;
  }
}

export function AdminProjectsTable({ onProjectsChanged }: Props) {
  const [rows, setRows] = useState<AdminProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [busy, setBusy] = useState(false);
  const { showToast } = useToast();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listAdminProjects();
      setRows(data);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-fetch on mount.
  useEffect(() => {
    refresh();
  }, [refresh]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => {
        if (q && !r.slug.toLowerCase().includes(q)) return false;
        if (statusFilter === "all") return true;
        if (statusFilter === "idle") return r.sandbox_status === null;
        return r.sandbox_status === statusFilter;
      })
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [rows, search, statusFilter]);

  async function doConfirm() {
    if (!confirm) return;
    setBusy(true);
    const { type, slug } = confirm;
    try {
      if (type === "cancel") {
        await cancelSandbox(slug);
        showToast(`Sandbox de '${slug}' cancelada`, "info");
      } else {
        await deleteProject(slug);
        showToast(`Projeto '${slug}' deletado`, "info");
      }
      await refresh();
      onProjectsChanged();
    } catch (e) {
      showToast(friendlyError(e), "error");
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  return (
    <div
      style={{
        background: s.bg,
        border: `1px solid ${s.borderHover}`,
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      {/* Header: title + search + filter + refresh */}
      <div
        style={{
          padding: "0.75rem 1rem",
          borderBottom: `1px solid ${s.border}`,
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          background: "#0a0d14",
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontSize: "0.7rem",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: s.muted,
            marginRight: "auto",
          }}
        >
          Projetos ({filtered.length})
        </span>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar slug…"
          style={{
            background: s.surface,
            border: `1px solid ${s.borderHover}`,
            borderRadius: 4,
            color: s.text,
            padding: "5px 10px",
            fontSize: 12,
            outline: "none",
            width: 180,
          }}
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          style={{
            background: s.surface,
            border: `1px solid ${s.borderHover}`,
            borderRadius: 4,
            color: s.text,
            padding: "5px 8px",
            fontSize: 12,
            outline: "none",
            cursor: "pointer",
          }}
        >
          <option value="all">Todos</option>
          <option value="active">Active</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
          <option value="deleted">Deleted</option>
          <option value="idle">Idle (sem sandbox)</option>
        </select>
        <button
          onClick={refresh}
          style={{
            background: "transparent",
            border: `1px solid ${s.borderHover}`,
            borderRadius: 4,
            color: s.text,
            padding: "5px 12px",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          {loading ? "…" : "↻ Refresh"}
        </button>
      </div>

      {/* Body */}
      {loading && rows.length === 0 ? (
        <p style={{ padding: "2rem", textAlign: "center", color: s.muted, fontSize: 13 }}>
          Carregando…
        </p>
      ) : filtered.length === 0 ? (
        <p style={{ padding: "2rem", textAlign: "center", color: s.muted, fontSize: 13 }}>
          {search || statusFilter !== "all"
            ? "Nenhum projeto bate com o filtro."
            : "Nenhum projeto ainda."}
        </p>
      ) : (
        filtered.map((row) => (
          <div
            key={row.slug}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: "0.75rem",
              padding: "0.75rem 1rem",
              borderBottom: `1px solid ${s.border}`,
              alignItems: "center",
            }}
          >
            <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                <span style={{ fontWeight: 700, fontSize: "0.85rem", color: s.text }}>
                  {row.slug}
                </span>
                {row.ssg_id && (
                  <span
                    style={{
                      fontSize: "0.65rem",
                      color: s.muted,
                      background: s.surface,
                      border: `1px solid ${s.borderHover}`,
                      padding: "1px 6px",
                      borderRadius: 4,
                      fontFamily: "monospace",
                    }}
                  >
                    #{row.ssg_id}
                  </span>
                )}
                <span
                  style={{
                    fontSize: "0.65rem",
                    fontWeight: 700,
                    color: statusColor(row.sandbox_status),
                    background: s.surface,
                    border: `1px solid ${s.borderHover}`,
                    padding: "1px 6px",
                    borderRadius: 4,
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                  }}
                >
                  {row.sandbox_status ?? "idle"}
                </span>
                {row.github_repo_owner && row.github_repo_name && (
                  <span style={{ fontSize: "0.7rem", color: s.muted, fontFamily: "monospace" }}>
                    {row.github_repo_owner}/{row.github_repo_name}
                  </span>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                {/* 5 dots */}
                <div style={{ display: "flex", gap: 3 }}>
                  {PHASES.map((phase) => {
                    const approved = row.approved_phases.includes(phase.toUpperCase());
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
                        }}
                      />
                    );
                  })}
                </div>
                <span style={{ fontSize: "0.7rem", color: s.muted }}>
                  {row.approved_count}/{row.total_phases}
                </span>
                <span style={{ fontSize: "0.7rem", color: "#334155" }}>·</span>
                <span style={{ fontSize: "0.7rem", color: s.muted, fontFamily: "monospace" }}>
                  {row.created_at.slice(0, 10)}
                </span>
              </div>
              {row.idea_snippet && (
                <p
                  style={{
                    margin: 0,
                    fontSize: "0.72rem",
                    color: s.muted,
                    fontStyle: "italic",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  "{row.idea_snippet}"
                </p>
              )}
            </div>

            {/* Actions */}
            <div style={{ display: "flex", gap: "0.4rem", flexShrink: 0 }}>
              <button
                onClick={() => setConfirm({ type: "cancel", slug: row.slug })}
                disabled={row.sandbox_status === "cancelled" || row.sandbox_status === "deleted" || row.sandbox_status === null}
                title="Cancelar sandbox (mantém projeto)"
                style={{
                  background: "transparent",
                  border: `1px solid ${s.borderHover}`,
                  borderRadius: 4,
                  color: s.amber,
                  padding: "4px 10px",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: row.sandbox_status === "cancelled" || row.sandbox_status === "deleted" || row.sandbox_status === null ? "not-allowed" : "pointer",
                  opacity: row.sandbox_status === "cancelled" || row.sandbox_status === "deleted" || row.sandbox_status === null ? 0.4 : 1,
                }}
              >
                Cancelar sandbox
              </button>
              <button
                onClick={() => setConfirm({ type: "delete", slug: row.slug })}
                title="Deletar projeto inteiro"
                style={{
                  background: "transparent",
                  border: `1px solid #7f1d1d`,
                  borderRadius: 4,
                  color: s.red,
                  padding: "4px 10px",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Deletar projeto
              </button>
            </div>
          </div>
        ))
      )}

      {/* Confirm modais */}
      <ConfirmModal
        open={confirm?.type === "cancel"}
        title="Cancelar sandbox?"
        message={
          `Isso encerra o sandbox Daytona do slug '${confirm?.slug ?? ""}', mas o projeto continua. ` +
          "Próximo /ensure recria automaticamente quando precisar."
        }
        confirmLabel="Sim, cancelar sandbox"
        cancelLabel="Voltar"
        intent="primary"
        busy={busy}
        onConfirm={doConfirm}
        onClose={() => setConfirm(null)}
      />
      <ConfirmModal
        open={confirm?.type === "delete"}
        title="Deletar projeto inteiro?"
        message={
          `Isso APAGA TUDO do slug '${confirm?.slug ?? ""}': sandbox, todos os drafts e artefatos aprovados, ` +
          "e a row do projeto no banco. Não é reversível. Tem certeza?"
        }
        confirmLabel="Sim, deletar tudo"
        cancelLabel="Voltar"
        intent="danger"
        busy={busy}
        onConfirm={doConfirm}
        onClose={() => setConfirm(null)}
      />
    </div>
  );
}
