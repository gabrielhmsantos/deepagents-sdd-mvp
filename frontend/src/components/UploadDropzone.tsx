import { useRef } from "react";
import { uploadFile } from "../lib/api";
import type { UploadedFile } from "../lib/types";

interface Props {
  slug: string;
  files: UploadedFile[];
  onChange: (files: UploadedFile[]) => void;
}

const ALLOWED = [".pdf", ".docx", ".txt", ".md"];

export function UploadDropzone({ slug, files, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFiles(fileList: FileList) {
    for (const file of Array.from(fileList)) {
      const ext = "." + file.name.split(".").pop()?.toLowerCase();
      if (!ALLOWED.includes(ext)) {
        alert(`Formato não suportado: ${file.name}\nAceitos: ${ALLOWED.join(", ")}`);
        continue;
      }
      try {
        const effectiveSlug = slug || "default";
        const result = await uploadFile(effectiveSlug, file);
        onChange([
          ...files,
          { filename: result.filename, approxTokens: result.approx_tokens, selected: true, uploadSlug: effectiveSlug },
        ]);
      } catch (e) {
        alert(`Erro ao enviar ${file.name}: ${(e as Error).message}`);
      }
    }
  }

  function toggleFile(filename: string) {
    onChange(files.map((f) => f.filename === filename ? { ...f, selected: !f.selected } : f));
  }

  function removeFile(filename: string) {
    onChange(files.filter((f) => f.filename !== filename));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files); }}
        style={{
          border: "1.5px dashed #475569", borderRadius: "0.5rem", padding: "0.75rem 1rem",
          cursor: "pointer", textAlign: "center", color: "#64748b", fontSize: "0.8rem",
          transition: "border-color 0.15s",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#7c3aed")}
        onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#475569")}
      >
        Soltar PDF / DOCX / TXT / MD aqui ou{" "}
        <span style={{ color: "#a78bfa", textDecoration: "underline" }}>clique para selecionar</span>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.docx,.txt,.md"
        multiple
        style={{ display: "none" }}
        onChange={(e) => { if (e.target.files?.length) handleFiles(e.target.files); }}
      />
      {files.map((f) => (
        <div
          key={f.filename}
          style={{
            display: "flex", alignItems: "center", gap: "0.5rem",
            background: "#1e293b", border: "1px solid #334155", borderRadius: "0.375rem",
            padding: "0.4rem 0.6rem", fontSize: "0.78rem",
          }}
        >
          <input
            type="checkbox"
            checked={f.selected}
            onChange={() => toggleFile(f.filename)}
            style={{ cursor: "pointer", accentColor: "#7c3aed" }}
          />
          <span style={{ flex: 1, color: "#cbd5e1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {f.filename}
          </span>
          <span style={{ color: "#64748b", whiteSpace: "nowrap" }}>
            ~{f.approxTokens.toLocaleString()} tokens
          </span>
          <button
            onClick={() => removeFile(f.filename)}
            style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b", fontSize: "0.9rem", lineHeight: 1 }}
            title="Remover"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
