import type {
  AdminProjectRow,
  EnsureBody,
  EnsureResponse,
  GithubRepo,
  Project,
  ProjectCreateBody,
  ProjectCreateResponse,
} from "./types";

const BASE = "/api";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// Mapeia erros conhecidos pra mensagens amigáveis de UX. Use em catch blocks
// antes de `showToast(...)` pra não vazar status HTTP cru pro usuário.
export function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("400") && /pat/i.test(msg) && /configur/i.test(msg)) {
    return "Configure o GitHub PAT no ⚙ Configurações primeiro.";
  }
  if (msg.includes("400") && /ssg_id/i.test(msg)) {
    return "SSG ID deve ser 1-5 dígitos numéricos.";
  }
  if (msg.includes("400") && /github_repo_(owner|name)/i.test(msg)) {
    return "Owner e repositório vêm juntos (ou ambos vazios pra greenfield).";
  }
  if (msg.includes("422") && /git clone/i.test(msg)) {
    return "Falha ao clonar repositório. Verifique URL/branch/permissões do PAT.";
  }
  if (msg.includes("502") && /github/i.test(msg)) {
    return "GitHub API indisponível ou rate-limit. Tente em alguns segundos.";
  }
  // Strip "HTTP_CODE: " prefix pra mensagens não-mapeadas.
  return msg.replace(/^\d{3}:\s*/, "");
}

// ── Sandbox lifecycle (Fase 1) ────────────────────────────────────────────────

// Garante sandbox vivo para o slug — idempotente, faz state machine A/B/C/D
// no backend (cria, acorda, recria conforme necessário). Body opcional: em
// estado A reusa repo_url/branch persistidos no DB se omitidos. Estado B
// retorna em <100ms (cache hit). Use antes de qualquer chamada que dependa
// do sandbox vivo (stream do agente, exec, etc.).
export async function ensureSandbox(
  slug: string,
  body: EnsureBody = {}
): Promise<EnsureResponse> {
  return json(
    await fetch(`${BASE}/ensure/${slug}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

// Cancela explicitamente o sandbox (deleta no Daytona + marca DB).
// Distinto de PhaseStream cancel: este destrói o sandbox; aquele só aborta
// o run corrente sem mexer no sandbox.
export async function cancelSandbox(slug: string): Promise<void> {
  await fetch(`${BASE}/cancel/${slug}`, { method: "POST" });
}

// ── Projects (Step 3) ─────────────────────────────────────────────────────────

// Cria projeto + sandbox eagerly. Entry point canonical do form unificado.
// Greenfield: omite github_repo_owner/name. Brownfield: ambos obrigatórios.
export async function createProject(
  body: ProjectCreateBody
): Promise<ProjectCreateResponse> {
  return json(
    await fetch(`${BASE}/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

// Lista todos os projetos pra alimentar o ProjectsSidebar.
export async function listProjects(): Promise<Project[]> {
  const data = await json<{ projects: Project[] }>(
    await fetch(`${BASE}/projects`)
  );
  return data.projects;
}

// Wipe completo de um projeto: sandbox + blob (drafts+features) + DB rows.
// Best-effort no backend; response trás flags por etapa pra debug.
export async function deleteProject(slug: string): Promise<void> {
  const res = await fetch(`${BASE}/projects/${slug}`, { method: "DELETE" });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status}: ${text}`);
  }
}

// View enriquecida pro admin panel: project + sandbox state + count de fases.
export async function listAdminProjects(): Promise<AdminProjectRow[]> {
  const data = await json<{ projects: AdminProjectRow[] }>(
    await fetch(`${BASE}/admin/projects`)
  );
  return data.projects;
}

// ── GitHub (Step 3) ───────────────────────────────────────────────────────────

// Proxy à GitHub API com PAT global. Alimenta o RepoPicker no form.
// Throws se PAT não configurado (400) ou erro upstream (502).
export async function listGithubRepos(): Promise<GithubRepo[]> {
  const data = await json<{ repos: GithubRepo[] }>(
    await fetch(`${BASE}/github/repos`)
  );
  return data.repos;
}

// ── Drafts ────────────────────────────────────────────────────────────────────

export async function writeDraft(slug: string, phase: string, content: string) {
  return json(
    await fetch(`${BASE}/drafts/${slug}/${phase}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    })
  );
}

export async function readDraft(slug: string, phase: string): Promise<string | null> {
  const data = await json<{ exists: boolean; content: string | null }>(
    await fetch(`${BASE}/drafts/${slug}/${phase}`)
  );
  return data.exists ? data.content : null;
}

export async function deleteDraft(slug: string, phase: string): Promise<void> {
  await fetch(`${BASE}/drafts/${slug}/${phase}`, { method: "DELETE" });
}

export async function listDrafts(slug: string): Promise<string[]> {
  const data = await json<{ drafts: string[] }>(await fetch(`${BASE}/drafts/${slug}`));
  return data.drafts;
}

// ── Approve ───────────────────────────────────────────────────────────────────

export async function approve(slug: string, phase: string) {
  return json(
    await fetch(`${BASE}/approve/${slug}/${phase}`, { method: "POST" })
  );
}

// ── Artifacts (aprovados) ─────────────────────────────────────────────────────

export async function listFeatures(): Promise<string[]> {
  const data = await json<{ features: string[] }>(await fetch(`${BASE}/artifacts`));
  return data.features;
}

export async function listArtifacts(slug: string): Promise<string[]> {
  const data = await json<{ artifacts: string[] }>(
    await fetch(`${BASE}/artifacts/${slug}`)
  );
  return data.artifacts;
}

export async function readArtifact(slug: string, phase: string): Promise<string | null> {
  const res = await fetch(`${BASE}/artifacts/${slug}/${phase}`);
  if (res.status === 404) return null;
  const data = await json<{ content: string }>(res);
  return data.content;
}

export function zipUrl(slug: string): string {
  return `${BASE}/artifacts/${encodeURIComponent(slug)}/zip`;
}

// ── Uploads ───────────────────────────────────────────────────────────────────

export interface UploadResult {
  filename: string;
  bytes: number;
  extracted_chars: number;
  approx_tokens: number;
}

export async function uploadFile(slug: string, file: File): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", file);
  return json(
    await fetch(`${BASE}/uploads/${slug}`, { method: "POST", body: form })
  );
}

export async function listUploads(slug: string): Promise<string[]> {
  const data = await json<{ files: string[] }>(await fetch(`${BASE}/uploads/${slug}`));
  return data.files;
}

export async function readExtracted(
  slug: string,
  filename: string
): Promise<{ content: string; approx_tokens: number }> {
  return json(await fetch(`${BASE}/uploads/${slug}/${filename}`));
}

export async function deleteUpload(slug: string, filename: string) {
  return json(
    await fetch(`${BASE}/uploads/${slug}/${filename}`, { method: "DELETE" })
  );
}

// ── Settings ──────────────────────────────────────────────────────────────────

export async function getGithubPat(): Promise<{ configured: boolean; masked: string | null }> {
  return json(await fetch(`${BASE}/settings/github-pat`));
}

export async function saveGithubPat(pat: string): Promise<void> {
  await json(
    await fetch(`${BASE}/settings/github-pat`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pat }),
    })
  );
}
