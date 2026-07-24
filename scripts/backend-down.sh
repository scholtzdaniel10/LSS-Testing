#!/usr/bin/env sh
# PLT-1 — stop portable backend stack.
set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

if [ "${1:-}" = "--volumes" ] || [ "${1:-}" = "-v" ]; then
    docker compose down -v
else
    docker compose down
fi
