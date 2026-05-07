const BASE = "/api";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
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
  const res = await fetch(`${BASE}/drafts/${slug}/${phase}`);
  if (res.status === 404) return null;
  const data = await json<{ content: string }>(res);
  return data.content;
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
