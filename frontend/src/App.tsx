import { useCallback, useEffect, useState } from "react";
import { deleteProject as deleteProjectApi, listAdminProjects, zipUrl } from "./lib/api";
import { PHASES } from "./lib/types";
import type { AdminProjectRow, Phase, Project, UploadedFile } from "./lib/types";
import { PhaseSection } from "./components/PhaseSection";
import { ProjectForm } from "./components/ProjectForm";
import { ProjectHeader } from "./components/ProjectHeader";
import { ProjectsSidebar } from "./components/ProjectsSidebar";
import { SettingsView } from "./components/SettingsView";
import { TerminalPanel } from "./components/TerminalPanel";
import { UploadDropzone } from "./components/UploadDropzone";

// Feature flags (build-time, Vite)
const POLL_ENABLED = import.meta.env.VITE_SANDBOX_POLL_ENABLED !== "false";
const POLL_INTERVAL_MS = Number(import.meta.env.VITE_SANDBOX_POLL_INTERVAL_MS) || 60_000;

type SandboxStatus = "idle" | "restarting" | "ready";
type ActiveView = "project" | "settings";

async function fetchSandboxStatus(
  slug: string
): Promise<{ status: SandboxStatus; repoPath: string | null }> {
  try {
    const r = await fetch(`/api/sandboxes/${slug}`);
    if (!r.ok) return { status: "idle", repoPath: null };
    const data = (await r.json()) as {
      exists: boolean;
      status: string;
      repo_path?: string | null;
    };
    if (!data.exists) return { status: "idle", repoPath: null };
    const status: SandboxStatus = data.status === "restarting" ? "restarting" : "ready";
    return { status, repoPath: data.repo_path ?? null };
  } catch {
    return { status: "idle", repoPath: null };
  }
}

// ── Persistência em localStorage ────────────────────────────────────────────
function useLocalStorage<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw !== null ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });

  const set = useCallback(
    (v: T | ((p: T) => T)) => {
      setValue((prev) => {
        const next = typeof v === "function" ? (v as (p: T) => T)(prev) : v;
        try {
          localStorage.setItem(key, JSON.stringify(next));
        } catch {
          /* noop */
        }
        return next;
      });
    },
    [key]
  );

  return [value, set];
}

// ── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [activeSlug, setActiveSlug] = useLocalStorage<string | null>(
    "champion-active-slug",
    null
  );
  const [activeView, setActiveView] = useState<ActiveView>("project");
  const [adminRows, setAdminRows] = useState<AdminProjectRow[]>([]);
  const [files, setFiles] = useLocalStorage<UploadedFile[]>("champion-files", []);

  const [sandboxStatus, setSandboxStatus] = useState<SandboxStatus>("idle");
  const [repoPath, setRepoPath] = useState<string | null>(null);
  const [terminalOpen, setTerminalOpen] = useState(false);

  // Derivações
  const activeProject = adminRows.find((r) => r.slug === activeSlug) ?? null;
  const isProjectSubmitted = activeProject !== null;
  const sandboxReady = sandboxStatus === "ready";
  const approvedPhases: Set<Phase> = new Set(
    (activeProject?.approved_phases ?? []).map((p) => p.toLowerCase() as Phase)
  );
  const activePhase = PHASES.find((p) => !approvedPhases.has(p));
  const allDone = approvedPhases.size === PHASES.length;

  // ── One-shot cleanup de localStorage legacy (Step 1-2 mantinha champion-slug
  // e champion-description; Step 3 moveu pra projects.idea + champion-active-slug).
  // Roda uma vez no mount; sem efeito se as keys já não existirem.
  useEffect(() => {
    try {
      localStorage.removeItem("champion-slug");
      localStorage.removeItem("champion-description");
    } catch {
      /* noop */
    }
  }, []);

  // ── Fetches ────────────────────────────────────────────────────────────────
  const refreshProjects = useCallback(async () => {
    try {
      const rows = await listAdminProjects();
      setAdminRows(rows);
    } catch {
      setAdminRows([]);
    }
  }, []);

  // Carrega lista no mount.
  useEffect(() => {
    refreshProjects();
  }, [refreshProjects]);

  // Se o `activeSlug` salvo no localStorage não bate com nenhum projeto após
  // carregar — limpa.
  useEffect(() => {
    if (activeSlug && adminRows.length > 0 && !adminRows.find((r) => r.slug === activeSlug)) {
      setActiveSlug(null);
    }
  }, [activeSlug, adminRows, setActiveSlug]);

  // Polling de sandbox status apenas pro activeSlug (alimenta TerminalPanel).
  useEffect(() => {
    if (!activeSlug) {
      setSandboxStatus("idle");
      setRepoPath(null);
      return;
    }
    fetchSandboxStatus(activeSlug).then(({ status, repoPath: rp }) => {
      setSandboxStatus(status);
      setRepoPath(rp);
    });
  }, [activeSlug]);

  useEffect(() => {
    if (!POLL_ENABLED || !activeSlug) return;
    const id = setInterval(() => {
      fetchSandboxStatus(activeSlug).then(({ status, repoPath: rp }) => {
        setSandboxStatus(status);
        if (rp) setRepoPath(rp);
      });
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [activeSlug]);

  // ── Callbacks ──────────────────────────────────────────────────────────────
  const onSelectProject = useCallback(
    (slug: string) => {
      setActiveSlug(slug);
      setActiveView("project");
    },
    [setActiveSlug]
  );

  const onNewProject = useCallback(() => {
    setActiveSlug(null);
    setActiveView("project");
  }, [setActiveSlug]);

  const onOpenSettings = useCallback(() => setActiveView("settings"), []);

  const onProjectCreated = useCallback(
    async (resp: { slug: string }) => {
      await refreshProjects();
      setActiveSlug(resp.slug);
      setActiveView("project");
    },
    [refreshProjects, setActiveSlug]
  );

  const onResetActiveProject = useCallback(async () => {
    if (!activeSlug) return;
    await deleteProjectApi(activeSlug);
    await refreshProjects();
    setActiveSlug(null);
  }, [activeSlug, refreshProjects, setActiveSlug]);

  const onApproved = useCallback(() => {
    // Aprovação de uma fase muda approved_phases — refetch admin pra atualizar
    // o 5-dots no sidebar e no header também.
    refreshProjects();
  }, [refreshProjects]);

  // Converte AdminProjectRow → Project pro ProjectHeader (que espera Project).
  const headerProject: Project | null = activeProject
    ? {
        slug: activeProject.slug,
        ssg_id: activeProject.ssg_id,
        idea: activeProject.idea,
        github_repo_owner: activeProject.github_repo_owner,
        github_repo_name: activeProject.github_repo_name,
        github_default_branch: activeProject.github_default_branch,
        created_at: activeProject.created_at,
      }
    : null;

  return (
    <div
      style={{
        minHeight: "100vh",
        height: "100vh",
        background: "#0a0d14",
        color: "#e2e8f0",
        fontFamily: "system-ui, sans-serif",
        display: "flex",
      }}
    >
      <ProjectsSidebar
        entries={adminRows}
        activeSlug={activeSlug}
        activeView={activeView}
        onSelectProject={onSelectProject}
        onNewProject={onNewProject}
        onOpenSettings={onOpenSettings}
      />

      <main
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          overflowY: "auto",
        }}
      >
        {activeView === "settings" ? (
          <SettingsView onProjectsChanged={refreshProjects} />
        ) : !headerProject ? (
          /* No active project → show ProjectForm */
          <ProjectForm onProjectCreated={onProjectCreated} onOpenSettings={onOpenSettings} />
        ) : (
          /* Project view: header + uploads + phases + (optional terminal) */
          <div
            style={{
              maxWidth: 960,
              margin: "0 auto",
              padding: "1.5rem",
              width: "100%",
              boxSizing: "border-box",
              display: "flex",
              flexDirection: "column",
              gap: "0.75rem",
            }}
          >
            <ProjectHeader project={headerProject} onReset={onResetActiveProject} />

            {/* Uploads (power-user — opcional pra cada fase) */}
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "0.7rem",
                  color: "#64748b",
                  marginBottom: "0.35rem",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Documentos base
              </label>
              <UploadDropzone slug={activeSlug ?? "default"} files={files} onChange={setFiles} />
            </div>

            {/* Terminal colapsável — power-user feature */}
            {sandboxReady && activeSlug && (
              <TerminalPanel
                slug={activeSlug}
                repoPath={repoPath}
                isOpen={terminalOpen}
                onToggle={() => setTerminalOpen((v) => !v)}
              />
            )}

            {/* PhaseSection × 5
                Key inclui slug pra remount limpa state ao trocar de projeto. */}
            {activeSlug &&
              PHASES.map((phase) => (
                <PhaseSection
                  key={`${phase}::${activeSlug}`}
                  phase={phase}
                  slug={activeSlug}
                  description={activeProject?.idea ?? ""}
                  files={files}
                  isApproved={approvedPhases.has(phase)}
                  isActive={phase === activePhase}
                  isLocked={!isProjectSubmitted || (!approvedPhases.has(phase) && phase !== activePhase)}
                  onApproved={onApproved}
                />
              ))}

            {allDone && (
              <div
                style={{
                  textAlign: "center",
                  padding: "2rem",
                  border: "1px solid #1e3a28",
                  borderRadius: "0.75rem",
                  background: "#0d1a11",
                  color: "#4ade80",
                  fontSize: "0.9rem",
                  display: "flex",
                  flexDirection: "column",
                  gap: "1rem",
                  alignItems: "center",
                }}
              >
                <div>
                  🎉 Pipeline completo! Artefatos em <code>.specs/features/{activeSlug}/</code>
                </div>
                <a
                  href={activeSlug ? zipUrl(activeSlug) : "#"}
                  download
                  style={{
                    display: "inline-block",
                    padding: "0.65rem 1.5rem",
                    background: "#22c55e",
                    color: "#052e16",
                    fontWeight: 700,
                    borderRadius: "0.5rem",
                    textDecoration: "none",
                    fontSize: "0.9rem",
                  }}
                >
                  ↓ Baixar pacote ZIP (5 artefatos + manifest + repo-tree)
                </a>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
