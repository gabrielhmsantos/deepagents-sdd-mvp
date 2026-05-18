"""SQLite data layer.

Tabelas espelhadas (com adaptações) do schema `be-champion-ai/src/external_integrations/db/schema.ts`
pra preparar portabilidade futura. Skipadas: jira/auth/job/SSE/telemetry/audit (decisão grill).

Mapeamento Champion ↔ MVP (Step 1):
  - projects                 → projects           (slug PK no MVP — endpoints existentes usam slug)
  - userGithubConfig         → user_github_settings (single-row via CHECK id=1)
  - githubProjectConfig      → github_project_config (FK em projects.slug)
  - globalSkills             → global_skills      (vazia no MVP — prompts vivem em prompts/*.md)
  - userSkillsConfig         → user_skills_config (vazia no MVP)
  - jobs/jobEvents/artifacts → SKIP (sem worker pattern)
  - userJiraConfig/jiraProjectConfig/jiraCreatedTickets → SKIP (sem Jira)

Convenções aplicadas (PG → SQLite):
  - uuid PK        → TEXT PRIMARY KEY (gerado via uuid4 na app)
  - timestamp[tz]  → TEXT NOT NULL DEFAULT (datetime('now'))     [ISO 8601]
  - jsonb (array)  → TEXT (json.dumps/loads manual)
  - boolean        → INTEGER 0/1
  - FK             → REFERENCES ... ON DELETE CASCADE
  - PRAGMA foreign_keys=ON ativado em get_conn

Legacy do MVP (mantidas):
  - sandboxes  (runtime state da Daytona — Fase 1)

Step 2 migrou PAT pra `user_github_settings`. Step 4 dropou `get_setting`/`set_setting`
+ tabela `settings` (dead code, 0 callers).
"""
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

DB_PATH = os.environ.get("DB_PATH", str(Path(__file__).parent / "db.sqlite"))


@contextmanager
def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    # Foreign keys são OFF por default no SQLite — precisa ativar por conexão.
    # Champion usa FKs pesadamente; sem isso, ON DELETE CASCADE não dispara.
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _existing_columns(conn, table: str) -> set[str]:
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return {row["name"] for row in rows}


def init_db() -> None:
    with get_conn() as conn:
        # ── Legacy MVP tables ──────────────────────────────────────────────
        # sandboxes guarda só lifecycle runtime — repo_url/branch foram movidos
        # pra projects (Step 2). ensure_sandbox lê metadata de projects via JOIN.
        conn.execute("""
            CREATE TABLE IF NOT EXISTS sandboxes (
                slug       TEXT PRIMARY KEY,
                sandbox_id TEXT NOT NULL,
                repo_path  TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                status     TEXT NOT NULL DEFAULT 'active'
            )
        """)

        # ── Champion-mirrored tables (Step 1) ──────────────────────────────

        # Mock single-row user pra alvo das FKs (MVP é single-user, sem auth).
        # Em Champion, users vem do Keycloak/JWT — aqui um seed 'default' basta.
        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id         TEXT PRIMARY KEY CHECK (id = 'default'),
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)
        # Seed do user único. INSERT OR IGNORE para idempotência.
        conn.execute("INSERT OR IGNORE INTO users (id) VALUES ('default')")

        # Project metadata. Diverge de Champion em 3 pontos:
        #   - slug PK (não UUID id) — endpoints/blob/sandbox já são keyed por slug
        #   - user_id default 'default' (MVP single-user)
        #   - +idea (texto do form de criação, MVP-specific)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS projects (
                slug                  TEXT PRIMARY KEY,
                user_id               TEXT NOT NULL DEFAULT 'default',
                ssg_id                TEXT,
                github_repo_owner     TEXT,
                github_repo_name      TEXT,
                github_default_branch TEXT,
                idea                  TEXT,
                created_at            TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        """)

        # PAT global per-user. Single-row enforced via CHECK(id=1).
        # repo_owner/repo_name/default_branch são "default repo" do user
        # (paridade com Champion); nullable no MVP — só PAT é obrigatório.
        conn.execute("""
            CREATE TABLE IF NOT EXISTS user_github_settings (
                id             INTEGER PRIMARY KEY CHECK (id = 1),
                user_id        TEXT NOT NULL UNIQUE DEFAULT 'default',
                repo_owner     TEXT,
                repo_name      TEXT,
                default_branch TEXT DEFAULT 'main',
                pat_token      TEXT,
                created_at     TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        """)

        # Per-project repo override. Vazia no MVP mas reflete Champion.
        # FK aponta pra projects.slug (não UUID — alinhado com MVP).
        conn.execute("""
            CREATE TABLE IF NOT EXISTS github_project_config (
                id             TEXT PRIMARY KEY,
                user_id        TEXT NOT NULL DEFAULT 'default',
                project_slug   TEXT NOT NULL,
                repo_owner     TEXT NOT NULL,
                repo_name      TEXT NOT NULL,
                default_branch TEXT NOT NULL DEFAULT 'main',
                created_at     TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE (user_id, project_slug),
                FOREIGN KEY (project_slug) REFERENCES projects(slug) ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        """)

        # Templates de prompt globais por step do pipeline.
        # Vazia no MVP — prompts hoje vivem em prompts/*.md (filesystem).
        # required_sections é JSON array serializado em TEXT.
        conn.execute("""
            CREATE TABLE IF NOT EXISTS global_skills (
                id                TEXT PRIMARY KEY,
                step              TEXT NOT NULL UNIQUE,
                system_prompt     TEXT NOT NULL,
                output_guidelines TEXT NOT NULL,
                when_editing      TEXT NOT NULL,
                required_sections TEXT NOT NULL DEFAULT '[]',
                created_at        TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)

        # Customizações per-user dos skills (instruções extras por step).
        # Vazia no MVP.
        conn.execute("""
            CREATE TABLE IF NOT EXISTS user_skills_config (
                id           TEXT PRIMARY KEY,
                user_id      TEXT NOT NULL DEFAULT 'default',
                step         TEXT NOT NULL,
                instructions TEXT NOT NULL DEFAULT '',
                created_at   TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE (user_id, step),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        """)

        # Metadados de arquivos enviados por projeto. O arquivo físico vive
        # em `.specs/uploads/{slug}/` (gerenciado por uploads.py); aqui só
        # registramos nome + tokens pra o frontend listar sem varrer disco.
        # CASCADE em project_slug garante limpeza automática ao deletar projeto.
        conn.execute("""
            CREATE TABLE IF NOT EXISTS project_files (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                project_slug  TEXT NOT NULL,
                filename      TEXT NOT NULL,
                approx_tokens INTEGER NOT NULL DEFAULT 0,
                created_at    TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE (project_slug, filename),
                FOREIGN KEY (project_slug) REFERENCES projects(slug) ON DELETE CASCADE
            )
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS clarification_sessions (
                thread_id   TEXT PRIMARY KEY,
                questions   TEXT NOT NULL,
                answers     TEXT,
                status      TEXT NOT NULL DEFAULT 'pending',
                created_at  TEXT NOT NULL DEFAULT (datetime('now')),
                answered_at TEXT
            )
        """)


# ══ Legacy helpers (sandboxes lifecycle) — mantidos pra Fase 1/2 ═════════════

def upsert_sandbox(slug: str, sandbox_id: str, repo_path: str | None) -> None:
    """Upsert lifecycle de sandbox. Metadata do projeto (repo_url/branch) vive
    em `projects` — ensure_sandbox lê de lá."""
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO sandboxes (slug, sandbox_id, repo_path, status)
            VALUES (?, ?, ?, 'active')
            ON CONFLICT(slug) DO UPDATE SET
                sandbox_id = excluded.sandbox_id,
                repo_path  = excluded.repo_path,
                status     = 'active'
            """,
            (slug, sandbox_id, repo_path),
        )


def update_sandbox_status(slug: str, status: str) -> None:
    with get_conn() as conn:
        conn.execute(
            "UPDATE sandboxes SET status = ? WHERE slug = ?",
            (status, slug),
        )


def get_active_sandboxes() -> list[sqlite3.Row]:
    with get_conn() as conn:
        return conn.execute(
            "SELECT slug, sandbox_id, repo_path FROM sandboxes WHERE status = 'active'"
        ).fetchall()


def get_sandbox_record(slug: str) -> sqlite3.Row | None:
    with get_conn() as conn:
        return conn.execute(
            "SELECT slug, sandbox_id, repo_path, status FROM sandboxes WHERE slug = ?",
            (slug,),
        ).fetchone()


def count_active_sandboxes() -> int:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT COUNT(*) FROM sandboxes WHERE status = 'active'"
        ).fetchone()
        return row[0] if row else 0


# ══ Step 1 helpers (projects + user_github_settings) ═════════════════════════

def upsert_project(
    slug: str,
    ssg_id: str | None = None,
    github_repo_owner: str | None = None,
    github_repo_name: str | None = None,
    github_default_branch: str | None = None,
    idea: str | None = None,
) -> None:
    """Insert or update a project row. user_id implícito = 'default' (single-user).

    Não toca em created_at no update; mas atualiza updated_at sempre.
    """
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO projects (
                slug, ssg_id, github_repo_owner, github_repo_name,
                github_default_branch, idea
            )
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(slug) DO UPDATE SET
                ssg_id                = excluded.ssg_id,
                github_repo_owner     = excluded.github_repo_owner,
                github_repo_name      = excluded.github_repo_name,
                github_default_branch = excluded.github_default_branch,
                idea                  = excluded.idea,
                updated_at            = datetime('now')
            """,
            (slug, ssg_id, github_repo_owner, github_repo_name,
             github_default_branch, idea),
        )


def get_project(slug: str) -> sqlite3.Row | None:
    with get_conn() as conn:
        return conn.execute(
            "SELECT * FROM projects WHERE slug = ?", (slug,)
        ).fetchone()


def list_projects() -> list[sqlite3.Row]:
    with get_conn() as conn:
        return conn.execute(
            "SELECT * FROM projects ORDER BY created_at DESC"
        ).fetchall()


def delete_project(slug: str) -> bool:
    """Apaga row em projects. FKs em CASCADE removem github_project_config relacionados.

    Não toca em sandboxes (que tem o próprio lifecycle via cancel/remove).
    Retorna True se uma row foi apagada.
    """
    with get_conn() as conn:
        cursor = conn.execute("DELETE FROM projects WHERE slug = ?", (slug,))
        return cursor.rowcount > 0


def get_user_github_pat() -> str | None:
    """PAT global do single-user. None se ainda não configurado."""
    with get_conn() as conn:
        row = conn.execute(
            "SELECT pat_token FROM user_github_settings WHERE id = 1"
        ).fetchone()
        return row["pat_token"] if row and row["pat_token"] else None


def set_user_github_pat(pat: str) -> None:
    """Upsert do PAT no single-row. user_id implícito = 'default'."""
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO user_github_settings (id, pat_token)
            VALUES (1, ?)
            ON CONFLICT(id) DO UPDATE SET
                pat_token  = excluded.pat_token,
                updated_at = datetime('now')
            """,
            (pat,),
        )


# ══ Project files (per-project upload metadata) ══════════════════════════════

def add_project_file(slug: str, filename: str, approx_tokens: int) -> None:
    """Registra (ou atualiza) metadados de um arquivo enviado pro projeto."""
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO project_files (project_slug, filename, approx_tokens)
            VALUES (?, ?, ?)
            ON CONFLICT(project_slug, filename) DO UPDATE SET
                approx_tokens = excluded.approx_tokens
            """,
            (slug, filename, approx_tokens),
        )


def list_project_files(slug: str) -> list[sqlite3.Row]:
    """Lista metadados dos arquivos enviados pra um projeto."""
    with get_conn() as conn:
        return conn.execute(
            "SELECT filename, approx_tokens, created_at FROM project_files WHERE project_slug = ? ORDER BY created_at",
            (slug,),
        ).fetchall()


def delete_project_file(slug: str, filename: str) -> bool:
    """Remove registro de arquivo. Retorna True se algo foi removido."""
    with get_conn() as conn:
        cursor = conn.execute(
            "DELETE FROM project_files WHERE project_slug = ? AND filename = ?",
            (slug, filename),
        )
        return cursor.rowcount > 0


# ══ Clarification sessions (human-in-the-loop) ═══════════════════════════════

def create_clarification(thread_id: str, questions: list[dict]) -> None:
    import json as _json
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO clarification_sessions (thread_id, questions, answers, status)
            VALUES (?, ?, NULL, 'pending')
            ON CONFLICT(thread_id) DO UPDATE SET
                questions   = excluded.questions,
                answers     = NULL,
                status      = 'pending',
                answered_at = NULL,
                created_at  = datetime('now')
            """,
            (thread_id, _json.dumps(questions, ensure_ascii=False)),
        )


def get_clarification(thread_id: str) -> sqlite3.Row | None:
    with get_conn() as conn:
        return conn.execute(
            "SELECT * FROM clarification_sessions WHERE thread_id = ?",
            (thread_id,),
        ).fetchone()


def set_clarification_answers(thread_id: str, answers: list) -> bool:
    import json as _json
    with get_conn() as conn:
        cursor = conn.execute(
            """
            UPDATE clarification_sessions
            SET answers = ?, status = 'answered', answered_at = datetime('now')
            WHERE thread_id = ? AND status = 'pending'
            """,
            (_json.dumps(answers, ensure_ascii=False), thread_id),
        )
        return cursor.rowcount > 0


def delete_clarification(thread_id: str) -> None:
    with get_conn() as conn:
        conn.execute(
            "DELETE FROM clarification_sessions WHERE thread_id = ?", (thread_id,)
        )
