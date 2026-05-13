import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

DB_PATH = os.environ.get("DB_PATH", str(Path(__file__).parent / "db.sqlite"))


@contextmanager
def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    with get_conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS sandboxes (
                slug       TEXT PRIMARY KEY,
                sandbox_id TEXT NOT NULL,
                repo_path  TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                status     TEXT NOT NULL DEFAULT 'active'
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        """)


def upsert_sandbox(slug: str, sandbox_id: str, repo_path: str | None) -> None:
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


def count_active_sandboxes() -> int:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT COUNT(*) FROM sandboxes WHERE status = 'active'"
        ).fetchone()
        return row[0] if row else 0


def get_setting(key: str) -> str | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT value FROM settings WHERE key = ?", (key,)
        ).fetchone()
        return row["value"] if row else None


def set_setting(key: str, value: str) -> None:
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO settings (key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            """,
            (key, value),
        )
