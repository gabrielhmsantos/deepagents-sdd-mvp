#!/usr/bin/env python3
"""
Verificação E2E do lifecycle de sandbox (Fases 1 e 2).

Pré-requisitos:
  - Backend rodando: uv run langgraph dev --port 8000 --no-browser
  - DAYTONA_API_KEY configurado no .env

Uso:
  uv run python e2e_check.py --slug meu-slug --repo-url https://github.com/org/repo
  uv run python e2e_check.py --slug meu-slug --repo-url https://github.com/org/repo --branch develop
  uv run python e2e_check.py --slug meu-slug --no-repo   # sandbox greenfield (sem clone)
"""

import argparse
import re
import sys
import time
import urllib.request
import urllib.error
import json as _json

BASE = "http://localhost:8000"

# Parse https://github.com/{owner}/{repo}(.git)? → (owner, repo)
_GH_RE = re.compile(r"https?://github\.com/([^/]+)/([^/]+?)(?:\.git)?/?$")


def _parse_repo_url(url: str) -> tuple[str, str]:
    m = _GH_RE.match(url.strip())
    if not m:
        raise ValueError(f"URL GitHub inválido: {url}")
    return m.group(1), m.group(2)


def _req(method: str, path: str, body: dict | None = None) -> tuple[int, dict]:
    url = BASE + path
    data = _json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, _json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, _json.loads(e.read())


def ok(msg: str) -> None:
    print(f"  \033[32m✓\033[0m {msg}")


def fail(msg: str) -> None:
    print(f"  \033[31m✗\033[0m {msg}")
    sys.exit(1)


def step(title: str) -> None:
    print(f"\n\033[1m{title}\033[0m")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--slug", required=True)
    parser.add_argument("--repo-url", default=None)
    parser.add_argument("--branch", default="main")
    parser.add_argument("--no-repo", action="store_true", help="Cria sandbox sem clone (greenfield)")
    args = parser.parse_args()

    slug = args.slug
    repo_url = None if args.no_repo else args.repo_url
    if not args.no_repo and not args.repo_url:
        parser.error("--repo-url obrigatório (ou use --no-repo para greenfield)")

    print(f"\n=== E2E Sandbox Lifecycle — slug: {slug} ===")

    # ── Criação canonical via POST /projects (Step 2) ─────────────────────────
    step("1. Criar projeto + sandbox (POST /projects)")
    body: dict = {"slug": slug, "idea": "[e2e test]"}
    if repo_url:
        owner, repo = _parse_repo_url(repo_url)
        body["github_repo_owner"] = owner
        body["github_repo_name"] = repo
        body["github_default_branch"] = args.branch

    t0 = time.monotonic()
    status, resp = _req("POST", "/projects", body)
    elapsed = time.monotonic() - t0

    if status != 200:
        fail(f"HTTP {status}: {resp}")
    ok(f"projeto+sandbox criados em {elapsed:.1f}s — id: {resp.get('sandbox_id')}")
    sandbox_id = resp.get("sandbox_id")
    repo_path = resp.get("repo_path")
    mode = resp.get("mode")
    ok(f"mode: {mode}, repo_path: {repo_path}")

    # ── Estado B: idempotência via /ensure (sem body) ─────────────────────────
    step("2. Estado B — /ensure idempotente (sem body)")
    t0 = time.monotonic()
    status, resp2 = _req("POST", f"/ensure/{slug}", None)
    elapsed = time.monotonic() - t0

    if status != 200:
        fail(f"HTTP {status}: {resp2}")
    if resp2.get("sandbox_id") != sandbox_id:
        fail(f"sandbox_id diferente: esperado {sandbox_id}, got {resp2.get('sandbox_id')}")
    if elapsed > 2.0:
        fail(f"Estado B demorou {elapsed:.1f}s — esperado < 2s (deve ser no-op)")
    ok(f"retornou em {elapsed:.2f}s, mesmo sandbox_id")

    # ── GET /sandboxes/{slug} ─────────────────────────────────────────────────
    step("3. Status do sandbox")
    status, info = _req("GET", f"/sandboxes/{slug}")
    if status != 200:
        fail(f"HTTP {status}: {info}")
    ok(f"status: {info.get('status')} | sandbox_id: {info.get('sandbox_id')}")

    # ── Hidratação (Fase 2): verificar specs no sandbox ───────────────────────
    if repo_url:
        step("4. Hidratação — /home/daytona/specs/{slug}/ deve existir no sandbox")
        print("     (verificar manualmente via painel Daytona ou exec)")
        print(f"     path esperado: /home/daytona/specs/{slug}/")
        print("     Em um sandbox com fases já aprovadas, os .md devem estar lá.")

    # ── Cancel ────────────────────────────────────────────────────────────────
    step("5. Cancel — deletar sandbox")
    resp_input = input("     Deletar o sandbox agora? [s/N] ").strip().lower()
    if resp_input == "s":
        status, resp3 = _req("POST", f"/cancel/{slug}")
        if status != 200:
            fail(f"HTTP {status}: {resp3}")
        ok(f"cancelado — status: {resp3.get('status')}")

        # Estado A novamente após cancel (projects row persiste — /ensure detecta
        # status terminal em sandboxes e recria a sandbox lendo de projects)
        step("6. Estado A — recriar após cancel via /ensure (sem body)")
        t0 = time.monotonic()
        status, resp4 = _req("POST", f"/ensure/{slug}", None)
        elapsed = time.monotonic() - t0
        if status != 200:
            fail(f"HTTP {status}: {resp4}")
        if resp4.get("sandbox_id") == sandbox_id:
            fail("sandbox_id igual ao anterior — deveria ser novo após cancel")
        ok(f"novo sandbox em {elapsed:.1f}s — id: {resp4.get('sandbox_id')}")
    else:
        ok("cancel pulado")

    print(f"\n\033[1;32mTodos os checks passaram para slug '{slug}'\033[0m\n")
    print("Verificações que exigem interação manual:")
    print("  Estado C (auto-stop): aguarde DAYTONA_AUTO_STOP_INTERVAL_MIN, depois chame /ensure novamente")
    print("  Estado D (delete externo): delete o sandbox no painel Daytona, depois chame /ensure")
    print("  Concorrência: use dois terminais e chame /ensure simultaneamente para um slug novo")


if __name__ == "__main__":
    main()
