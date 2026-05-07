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
  blocks.push(`[SALVAR EM]\n.specs/drafts/${params.slug}/${phase.toUpperCase()}.md`);

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
  currentContent: string,
  instructions: string
): string {
  return [
    `[ARTEFATO ${phase.toUpperCase()} ATUAL]\n${currentContent}`,
    `[INSTRUÇÕES DE EDIÇÃO]\n${instructions}`,
  ].join("\n\n---\n\n");
}
