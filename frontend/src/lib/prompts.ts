import type { Phase } from "./types";

// Fase 2: artefatos vivem no sandbox Daytona em /home/daytona/specs/{slug}/{PHASE}.md.
// O backend hidrata esse diretório a partir do blob no /ensure antes de cada run,
// e snapshota o draft pro blob (namespace=drafts) ao final de cada execução do agente.
// O agente lê predecessores via read_file nesse path (sem injeção no system prompt).
const SPECS_BASE = "/home/daytona/specs";

function draftPath(slug: string, phase: Phase): string {
  return `${SPECS_BASE}/${slug}/${phase.toUpperCase()}.md`;
}

export function buildInitialInput(
  phase: Phase,
  params: {
    slug: string;
    description: string;
    uploads?: { filename: string; content: string }[];
  }
): string {
  const blocks: string[] = [];

  blocks.push(`[SALVAR EM]\n${draftPath(params.slug, phase)}`);

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
  const path = draftPath(slug, phase);
  return [
    `[SALVAR EM]\n${path}`,
    `[MODO EDIÇÃO]\nO arquivo já existe em ${path}.\nUse a ferramenta edit_file para fazer substituições cirúrgicas (old_string → new_string).\nNÃO use write_file. NÃO reescreva o arquivo inteiro. Faça apenas as alterações solicitadas.`,
    `[ARTEFATO ${phase.toUpperCase()} ATUAL]\n${currentContent}`,
    `[INSTRUÇÕES DE EDIÇÃO]\n${instructions}`,
  ].join("\n\n---\n\n");
}
