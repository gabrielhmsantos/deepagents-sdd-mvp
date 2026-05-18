import { useState } from "react";
import type { ClarificationQuestion } from "../hooks/useArtifactAgent";

interface Props {
  questions: ClarificationQuestion[];
  onSubmit: (answers: (string | string[])[]) => void;
}

export function ClarificationDialog({ questions, onSubmit }: Props) {
  const [answers, setAnswers] = useState<(string | string[])[]>(
    questions.map((q) => (q.type === "checkbox" ? [] : ""))
  );

  const allAnswered = answers.every((a) =>
    Array.isArray(a) ? a.length > 0 : a.trim() !== ""
  );

  const setAnswer = (i: number, value: string | string[]) =>
    setAnswers((prev) => prev.map((a, idx) => (idx === i ? value : a)));

  const toggleCheckbox = (i: number, option: string) => {
    const current = answers[i] as string[];
    setAnswer(
      i,
      current.includes(option)
        ? current.filter((v) => v !== option)
        : [...current, option]
    );
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.75)",
        backdropFilter: "blur(3px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 200,
      }}
    >
      <div
        style={{
          background: "#1e293b",
          border: "1px solid #7c3aed",
          borderRadius: "0.75rem",
          padding: "1.5rem",
          width: "min(90vw, 560px)",
          display: "flex",
          flexDirection: "column",
          gap: "1.25rem",
          maxHeight: "80vh",
          overflowY: "auto",
        }}
      >
        <div>
          <h3 style={{ color: "#f8fafc", fontSize: "1rem", fontWeight: 700, margin: 0 }}>
            O agente precisa de mais informações
          </h3>
          <p style={{ color: "#94a3b8", fontSize: "0.8rem", margin: "0.4rem 0 0" }}>
            Responda para continuar a geração do artefato.
          </p>
        </div>

        {questions.map((q, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <label style={{ color: "#e2e8f0", fontSize: "0.875rem", fontWeight: 600 }}>
              {i + 1}. {q.question}
            </label>

            {q.type === "text" && (
              <input
                type="text"
                value={answers[i] as string}
                onChange={(e) => setAnswer(i, e.target.value)}
                autoFocus={i === 0}
                style={{
                  background: "#0f1117",
                  border: "1px solid #475569",
                  borderRadius: "0.375rem",
                  color: "#e2e8f0",
                  padding: "0.5rem 0.625rem",
                  fontSize: "0.875rem",
                  outline: "none",
                  width: "100%",
                  boxSizing: "border-box",
                }}
              />
            )}

            {q.type === "radio" &&
              q.options?.map((opt) => (
                <label
                  key={opt}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    color: "#cbd5e1",
                    fontSize: "0.85rem",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="radio"
                    name={`clarification-q${i}`}
                    value={opt}
                    checked={answers[i] === opt}
                    onChange={() => setAnswer(i, opt)}
                  />
                  {opt}
                </label>
              ))}

            {q.type === "checkbox" &&
              q.options?.map((opt) => (
                <label
                  key={opt}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    color: "#cbd5e1",
                    fontSize: "0.85rem",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    value={opt}
                    checked={(answers[i] as string[]).includes(opt)}
                    onChange={() => toggleCheckbox(i, opt)}
                  />
                  {opt}
                </label>
              ))}
          </div>
        ))}

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={() => allAnswered && onSubmit(answers)}
            disabled={!allAnswered}
            style={{
              padding: "0.5rem 1.25rem",
              borderRadius: "0.375rem",
              border: "none",
              background: allAnswered ? "#7c3aed" : "#334155",
              color: allAnswered ? "#fff" : "#64748b",
              cursor: allAnswered ? "pointer" : "not-allowed",
              fontSize: "0.875rem",
              fontWeight: 600,
            }}
          >
            Responder e continuar
          </button>
        </div>
      </div>
    </div>
  );
}
