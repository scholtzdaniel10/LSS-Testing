#!/usr/bin/env sh
# PLT-1 — start portable backend (api + worker + postgres + redis).
set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_DOCKER="$REPO_ROOT/apps/api/.env.docker"

if ! command -v docker >/dev/null 2>&1; then
    echo "Docker is not installed or not on PATH." >&2
    exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
    echo "Docker Compose v2 is required (docker compose)." >&2
    exit 1
fi

ensure_app_key() {
    if [ ! -f "$ENV_DOCKER" ]; then
        echo "Missing $ENV_DOCKER" >&2
        exit 1
    fi
    current="$(grep -E '^[[:space:]]*APP_KEY=' "$ENV_DOCKER" | head -n1 | cut -d= -f2- | tr -d '\r' || true)"
    if [ -z "$current" ] || [ "$current" = "base64:" ]; then
        if command -v openssl >/dev/null 2>&1; then
            generated="base64:$(openssl rand -base64 32)"
        else
            generated="base64:$(dd if=/dev/urandom bs=32 count=1 2>/dev/null | base64 | tr -d '\n')"
        fi
        if grep -qE '^[[:space:]]*APP_KEY=' "$ENV_DOCKER"; then
            sed -i.bak "s|^[[:space:]]*APP_KEY=.*|APP_KEY=$generated|" "$ENV_DOCKER"
            rm -f "$ENV_DOCKER.bak"
        else
            printf '\nAPP_KEY=%s\n' "$generated" >>"$ENV_DOCKER"
        fi
        echo "Wrote new APP_KEY to apps/api/.env.docker"
    fi
}

ensure_app_key

cd "$REPO_ROOT"
echo "Building and starting backend stack..."
docker compose up -d --build

HEALTH_URL="http://127.0.0.1:8000/api/v1/health"
echo "Waiting for $HEALTH_URL ..."
deadline=$(( $(date +%s) + 300 ))
while true; do
    if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
        echo "API healthy."
        break
    fi
    if [ "$(date +%s)" -ge "$deadline" ]; then
        echo "Timed out waiting for API health. Check: docker compose logs api" >&2
        exit 1
    fi
    sleep 3
done

cat <<'EOF'

Portable backend is up:
  API      http://127.0.0.1:8000  (GET /api/v1/health)
  Postgres localhost:5432  (lss / lss / database lss)
  Redis    localhost:6379

Next steps:
  1. Seed users (first time): docker compose exec api php artisan db:seed --force
  2. Issue web token:         docker compose exec api php artisan token:issue jean@lss.local --label=web
  3. Web UI:                  cd apps/web && npm install && npm run dev
  4. Stop stack:              ./scripts/backend-down.sh

Tier 1 Electron exe uses its own bundled PHP sidecar (Windows). This compose stack is the shared cross-platform backend for dev.
EOF
