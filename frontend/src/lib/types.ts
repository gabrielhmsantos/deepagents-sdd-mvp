export type Phase =
  | "constituicao"
  | "prd"
  | "especificacao"
  | "plano"
  | "tarefas";

export const PHASES: Phase[] = [
  "constituicao",
  "prd",
  "especificacao",
  "plano",
  "tarefas",
];

export const PHASE_LABELS: Record<Phase, string> = {
  constituicao: "Constituição",
  prd: "PRD",
  especificacao: "Especificação",
  plano: "Plano",
  tarefas: "Tarefas",
};

export const PHASE_DESCRIPTIONS: Record<Phase, string> = {
  constituicao: "Visão, princípios, critérios de decisão e escopo do produto",
  prd: "Épico com requisitos de negócio (BR-XXX), métricas e riscos",
  especificacao: "User stories P1/P2/P3, critérios de aceite e rastreabilidade (FR-XXX)",
  plano: "Arquitetura, decisões técnicas e estrutura de arquivos",
  tarefas: "Tasks atômicas com gates de verificação e commits Conventional",
};

export interface UploadedFile {
  filename: string;
  approxTokens: number;
  selected: boolean;
  uploadSlug: string;  // slug usado no momento do upload
}
