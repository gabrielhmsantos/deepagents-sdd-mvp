# /// script
# dependencies = ["daytona>=0.176.0"]
# requires-python = ">=3.12"
# ///
"""
Publishes Dockerfile.daytona.sandbox as snapshot sdd-image:1 to Daytona.
Run from repo root: uv run backend/scripts/publish_snapshot.py
"""

import os
import sys
from pathlib import Path

from daytona import CreateSnapshotParams, Daytona, DaytonaConfig, Image

SNAPSHOT_NAME = "sdd-image:1"
BACKEND_DIR = Path(__file__).resolve().parent.parent
DOCKERFILE = BACKEND_DIR / "Dockerfile.daytona.sandbox"

api_key = os.environ.get("DAYTONA_API_KEY")
if not api_key:
    env_file = BACKEND_DIR / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            if line.startswith("DAYTONA_API_KEY="):
                api_key = line.split("=", 1)[1].strip()
                break

if not api_key:
    print("ERROR: DAYTONA_API_KEY not found in environment or backend/.env")
    sys.exit(1)

print(f"Building snapshot '{SNAPSHOT_NAME}' from {DOCKERFILE.name} ...")

client = Daytona(DaytonaConfig(api_key=api_key))
image = Image.from_dockerfile(str(DOCKERFILE))

snapshot = client.snapshot.create(
    CreateSnapshotParams(name=SNAPSHOT_NAME, image=image),
    on_logs=lambda chunk: print(chunk, end="", flush=True),
)

print(f"\nDone. Snapshot id: {snapshot.id}  state: {snapshot.state}")
print(f"Set DAYTONA_SNAPSHOT={SNAPSHOT_NAME} in backend/.env to use it.")
