import type { Phase } from "./types";

export function buildInitialInput(
  phase: Phase,
  params: {
    slug: string;
    description: string;
    previous?: Partial<Record<Phase, string>>;
    uploads?: { filename: string; content: string }[];
  }
): string {
  const blocks: string[] = [];

  // Instrui o agente a salvar o artefato diretamente no filesystem
  blocks.push(`[SALVAR EM]\ndrafts/${params.slug}/${phase.toUpperCase()}.md`);

  for (const u of params.uploads ?? []) {
    blocks.push(`[DOCUMENTO BASE: ${u.filename}]\n${u.content}`);
  }

  for (const [k, v] of Object.entries(params.previous ?? {})) {
    if (v) blocks.push(`[${k.toUpperCase()} APROVADA]\n${v}`);
  }

  blocks.push(
    `[INPUT — ${phase.toUpperCase()} para o épico "${params.slug}"]\n${params.description}`
  );

  return blocks.join("\n\n---\n\n");
}

export function buildEditInput(
  phase: Phase,
  slug: string,
  currentContent: string,
  instructions: string
): string {
  const path = `drafts/${slug}/${phase.toUpperCase()}.md`;
  return [
    `[SALVAR EM]\n${path}`,
    `[MODO EDIÇÃO]\nO arquivo já existe em ${path}.\nUse a ferramenta edit_file para fazer substituições cirúrgicas (old_string → new_string).\nNÃO use write_file. NÃO reescreva o arquivo inteiro. Faça apenas as alterações solicitadas.`,
    `[ARTEFATO ${phase.toUpperCase()} ATUAL]\n${currentContent}`,
    `[INSTRUÇÕES DE EDIÇÃO]\n${instructions}`,
  ].join("\n\n---\n\n");
}
