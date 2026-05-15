import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

export type ToastIntent = "success" | "error" | "info";

interface Toast {
  id: number;
  message: string;
  intent: ToastIntent;
}

interface ToastContextValue {
  showToast: (message: string, intent?: ToastIntent) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const COLORS: Record<ToastIntent, { bg: string; border: string; text: string }> = {
  success: { bg: "#0d1a11", border: "#1e3a28", text: "#4ade80" },
  error: { bg: "#1a0d0d", border: "#7f1d1d", text: "#f87171" },
  info: { bg: "#0d1117", border: "#334155", text: "#94a3b8" },
};

const MAX_TOASTS = 3;
const AUTO_DISMISS_MS = 3000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const showToast = useCallback((message: string, intent: ToastIntent = "info") => {
    const id = nextId.current++;
    setToasts((prev) => {
      const next = [...prev, { id, message, intent }];
      // Cap at MAX_TOASTS; descarta os mais antigos.
      return next.length > MAX_TOASTS ? next.slice(-MAX_TOASTS) : next;
    });
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div
        style={{
          position: "fixed",
          top: 16,
          right: 16,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          zIndex: 200,
          pointerEvents: "none",
        }}
      >
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  useEffect(() => {
    const id = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(id);
  }, [onDismiss]);

  const c = COLORS[toast.intent];

  return (
    <div
      onClick={onDismiss}
      style={{
        background: c.bg,
        border: `1px solid ${c.border}`,
        borderRadius: 8,
        padding: "10px 16px",
        color: c.text,
        fontSize: 13,
        fontWeight: 500,
        minWidth: 240,
        maxWidth: 360,
        cursor: "pointer",
        pointerEvents: "auto",
        boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
      }}
    >
      {toast.message}
    </div>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Fallback: console + noop. Permite usar useToast em componentes
    // standalone (tests, storybook) sem o provider.
    return {
      showToast: (msg, intent) => console.warn(`[toast:${intent ?? "info"}] ${msg}`),
    };
  }
  return ctx;
}
