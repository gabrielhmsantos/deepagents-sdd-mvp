import type { Phase } from "./types";

// Artefatos prévios aprovados são injetados pelo backend (_factory.py) via
// system prompt. O frontend só envia o que é input do usuário: descrição,
// uploads e instrução de salvamento.
export function buildInitialInput(
  phase: Phase,
  params: {
    slug: string;
    description: string;
    uploads?: { filename: string; content: string }[];
  }
): string {
  const blocks: string[] = [];

  blocks.push(`[SALVAR EM]\ndrafts/${params.slug}/${phase.toUpperCase()}.md`);

  for (const u of params.uploads ?? []) {
    blocks.push(`[DOCUMENTO BASE: ${u.filename}]\n${u.content}`);
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
