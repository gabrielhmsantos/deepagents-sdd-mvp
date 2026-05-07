import { useRef } from "react";

interface Props {
  onConfirm: (instructions: string) => void;
  onCancel: () => void;
}

export function EditModeDialog({ onConfirm, onCancel }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50,
    }}>
      <div style={{
        background: "#1e293b", border: "1px solid #334155", borderRadius: "0.75rem",
        padding: "1.5rem", width: "min(90vw, 540px)", display: "flex", flexDirection: "column", gap: "1rem",
      }}>
        <h3 style={{ color: "#f8fafc", fontSize: "1rem", fontWeight: 600 }}>
          Solicitar alterações
        </h3>
        <p style={{ color: "#94a3b8", fontSize: "0.8rem" }}>
          Descreva o que deve ser alterado. IDs existentes (BR-XXX, FR-XXX, S-XXX) serão preservados.
          Novos IDs receberão o próximo número disponível.
        </p>
        <textarea
          ref={ref}
          autoFocus
          rows={5}
          placeholder="Ex: Adicionar NFR sobre LGPD relacionado a dados pessoais..."
          style={{
            background: "#0f1117", border: "1px solid #475569", borderRadius: "0.375rem",
            color: "#e2e8f0", padding: "0.625rem", fontSize: "0.875rem", resize: "vertical",
            fontFamily: "inherit", outline: "none",
          }}
        />
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
          <button
            onClick={onCancel}
            style={{
              padding: "0.5rem 1rem", borderRadius: "0.375rem", border: "1px solid #475569",
              background: "transparent", color: "#94a3b8", cursor: "pointer", fontSize: "0.875rem",
            }}
          >
            Cancelar
          </button>
          <button
            onClick={() => {
              const val = ref.current?.value.trim();
              if (val) onConfirm(val);
            }}
            style={{
              padding: "0.5rem 1rem", borderRadius: "0.375rem", border: "none",
              background: "#f59e0b", color: "#0f1117", cursor: "pointer",
              fontSize: "0.875rem", fontWeight: 600,
            }}
          >
            Re-gerar
          </button>
        </div>
      </div>
    </div>
  );
}
