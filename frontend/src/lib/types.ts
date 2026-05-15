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

// Body de POST /api/ensure/{slug}. Todos os campos opcionais — backend reusa
// repo_url/branch persistidos no DB quando omitidos. `repo_url: null` explícito
// cria sandbox sem clone (greenfield).
export interface EnsureBody {
  repo_url?: string | null;
  branch?: string;
}

// Resposta de POST /api/ensure/{slug}. `status` ∈ {ready, started, created}:
//   - ready   = estado B (sandbox já rodando, cache hit)
//   - started = estado C (estava stopped, foi acordado)
//   - created = estado A ou D (criado do zero ou recriado após delete)
export interface EnsureResponse {
  ok: boolean;
  sandbox_id: string;
  repo_path: string | null;
  status: "ready" | "started" | "created";
}

// ── Projects (Step 3) ─────────────────────────────────────────────────────────

export interface Project {
  slug: string;
  ssg_id: string | null;
  idea: string | null;
  github_repo_owner: string | null;
  github_repo_name: string | null;
  github_default_branch: string | null;
  created_at: string;
}

export interface ProjectCreateBody {
  slug: string;
  ssg_id?: string | null;
  github_repo_owner?: string | null;
  github_repo_name?: string | null;
  github_default_branch?: string | null;
  idea?: string | null;
}

export interface ProjectCreateResponse {
  ok: boolean;
  slug: string;
  sandbox_id: string;
  repo_path: string | null;
  mode: "brownfield" | "greenfield";
  status: "ready" | "started" | "created";
}

// Linha enriquecida do admin panel (project + sandbox state + count de fases aprovadas).
export interface AdminProjectRow {
  slug: string;
  ssg_id: string | null;
  idea: string | null;            // full text — usado pelo PhaseSection
  idea_snippet: string | null;    // 60 chars max — usado pela admin table display
  github_repo_owner: string | null;
  github_repo_name: string | null;
  github_default_branch: string | null;
  sandbox_status: string | null;  // active | cancelled | deleted | completed | null
  sandbox_id: string | null;
  approved_phases: string[];
  approved_count: number;
  total_phases: number;
  created_at: string;
}

// ── GitHub (Step 3) ───────────────────────────────────────────────────────────

export interface GithubRepo {
  owner: string;
  name: string;
  default_branch: string;
  private: boolean;
  description: string | null;
}
