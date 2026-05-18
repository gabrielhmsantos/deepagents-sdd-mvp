import { useEffect } from "react";

export type ConfirmIntent = "primary" | "danger";

interface Props {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  intent?: ConfirmIntent;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

const COLORS = {
  primary: { bg: "#7c3aed", text: "#fff" },
  danger: { bg: "#7f1d1d", text: "#fecaca" },
};

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  intent = "primary",
  busy = false,
  onConfirm,
  onClose,
}: Props) {
  // ESC fecha o modal (acessibilidade).
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, busy, onClose]);

  if (!open) return null;

  const c = COLORS[intent];

  return (
    <div
      onClick={() => !busy && onClose()}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(2px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#0f1117",
          border: "1px solid #334155",
          borderRadius: 8,
          padding: "1.5rem",
          maxWidth: 480,
          width: "90%",
          color: "#e2e8f0",
          boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
        }}
      >
        <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 700 }}>{title}</h3>
        <p style={{ margin: "0.75rem 0 1.5rem", fontSize: "0.85rem", color: "#94a3b8", lineHeight: 1.5 }}>
          {message}
        </p>
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            disabled={busy}
            style={{
              background: "transparent",
              border: "1px solid #334155",
              borderRadius: 6,
              color: "#cbd5e1",
              padding: "8px 16px",
              fontSize: 13,
              fontWeight: 600,
              cursor: busy ? "not-allowed" : "pointer",
            }}
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            style={{
              background: busy ? "#1e293b" : c.bg,
              color: busy ? "#64748b" : c.text,
              border: "none",
              borderRadius: 6,
              padding: "8px 16px",
              fontSize: 13,
              fontWeight: 600,
              cursor: busy ? "not-allowed" : "pointer",
            }}
          >
            {busy ? "..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
