# LSS-Testing — Maintenance System

A codebase **maintenance & health system**: the company drags a program in (its
codebase), and the system shows the health of that program — an Obsidian-like
dependency graph and node-tree explorer, a diagnostics pipeline that classifies
errors and traces their blast radius, Pest/Playwright test fabrication against
the app's own dev/staging environment, and a health dashboard that rolls it all
up per program.

**The spec lives in the shared Obsidian vault** (`scholtzdaniel10/LSS-vault`,
`Projects/Maintenance System/`) — architecture & contracts, feature milestones
with task IDs, UI map, data model, engineering standards. This repo is the
implementation. Agents: read `CLAUDE.md` first.

## Layout

| Path | What |
|---|---|
| `apps/web` | Ionic + React frontend (dashboard, graph explorer, diagnostics, test composer) |
| `apps/api` | Laravel backend (`/api/v1`) — import, analysis, health snapshots, test runner |
| `packages/schemas` | JSON Schemas for contracts C1–C7 |
| `packages/smoke` | `lss-smoke` CLI — Playwright/Chromium smoke-crawl, navigate-only |

## Security model (one paragraph, non-negotiable)

Imported program sources are **data, never code**: they are parsed in a
path-jailed sandbox and never executed. The only execution surface is the
company program's **own** dev/staging URL, registered per project, which the
Playwright runner drives. No credentials are persisted for targets.

## Local development

### Portable backend (any machine) — recommended for API

**Portable** here means: clone the repo, install **Docker Desktop** (or Docker Engine on Linux), run one script — you get Postgres, Redis, the Laravel API on **:8000**, and a queue worker. **No global PHP or Composer on the host** is required for the backend.

| Path | Role |
|---|---|
| **Docker Compose** (this repo) | Cross-platform shared backend for Daniel, Jean, and future devs (Windows / Mac / Linux) |
| **Tier 1 Electron exe** (`apps/desktop`) | Windows-local product build; bundles its own PHP sidecar + user's Postgres (DSK-2). Unchanged by compose. |

**Prerequisites:** Docker with Compose v2 (`docker compose version`).

**Start (pick one):**

```powershell
# Windows
.\scripts\backend-up.ps1
```

```sh
# macOS / Linux
chmod +x scripts/backend-up.sh scripts/backend-down.sh
./scripts/backend-up.sh
```

Equivalent manual command from repo root: `docker compose up -d --build` (scripts also ensure `APP_KEY` in `apps/api/.env.docker`, wait for health, and print token steps).

**Stop:**

```powershell
.\scripts\backend-down.ps1              # keep database volume
.\scripts\backend-down.ps1 -RemoveVolumes   # wipe Postgres + API storage volumes
```

```sh
./scripts/backend-down.sh
./scripts/backend-down.sh --volumes
```

**Handoff (Jean):** `git pull`, then `.\scripts\backend-up.ps1` (or `./scripts/backend-up.sh`). First time: `docker compose exec api php artisan db:seed --force`, then `docker compose exec api php artisan token:issue jean@lss.local --label=web`. Paste the token in **Settings**. Run the web app: `cd apps/web && npm install && npm run dev` (Vite proxies `/api` → `http://127.0.0.1:8000`).

**Local-link in Docker:** off by default (`SANDBOX_ALLOW_LOCAL_LINK=false` in `apps/api/.env.docker`). To link folders from the host, add read-only bind mounts under `x-api-service.volumes` in `docker-compose.yml` (e.g. `C:/LSS:/mnt/lss:ro`), set `SANDBOX_ALLOW_LOCAL_LINK=true` and `LOCAL_PATH_PREFIXES=/mnt/lss`, and use the **container** path in the UI.

**Legacy — host PHP + compose infra only:** still supported for developers who prefer `php artisan serve` on the host: `docker compose up -d postgres redis` then configure `apps/api/.env` (see below). Not required for the portable path.

### Database

**Postgres is the only supported local source-of-truth database (PLT-14).**
SQLite is CI/Pest-only (`phpunit.xml` runs it as `:memory:`) — never point
`artisan serve` or a queue worker at SQLite; its single-writer file lock
causes multi-hundred-ms stalls as soon as the web process and a queue worker
write concurrently.

**Happy path — native Postgres service (this machine, Postgres 16):** install
[PostgreSQL 16+](https://www.postgresql.org/download/windows/), then as the
postgres superuser: `CREATE ROLE lss LOGIN PASSWORD 'lss'; CREATE DATABASE lss
OWNER lss;`. Then:

```sh
cd apps/api
composer install   # or: php composer.phar install
cp .env.example .env && php artisan key:generate
# .env.example already defaults DB_CONNECTION=pgsql, host 127.0.0.1:5432, db/user/password lss
php artisan migrate --seed
```

**Happy path — Docker (API + worker + Postgres + Redis):** use [Portable backend](#portable-backend-any-machine--recommended-for-api) (`scripts/backend-up.*`) or:

```sh
docker compose up -d --build
curl http://127.0.0.1:8000/api/v1/health
```

Services: **Postgres** `localhost:5432`, **Redis** `localhost:6379`, **API** `http://127.0.0.1:8000` (`GET /api/v1/health`). Env for containers: `apps/api/.env.docker` (override `APP_KEY` with `php artisan key:generate --show` if you rotate it). The entrypoint waits for Postgres, runs `migrate --force`, then starts `artisan serve` or `queue:listen --timeout=660`.

**Web UI against Docker API:** `cd apps/web && npm install && npm run dev` — Vite proxies `/api` to `http://127.0.0.1:8000`. Paste a Sanctum token from `docker compose exec api php artisan token:issue daniel@lss.local --label=web` (after seeding users if needed: `docker compose exec api php artisan db:seed`).

**Local folder linking with Docker:** the API runs in a Linux container, so Windows paths from Settings must map to bind-mounted paths inside the container. In `docker-compose.yml` under `x-api-service.volumes`, add e.g. `C:/LSS:/mnt/lss:ro`, then set `SANDBOX_ALLOW_LOCAL_LINK=true` and `LOCAL_PATH_PREFIXES=/mnt/lss` in `apps/api/.env.docker`. Use the **container** path (`/mnt/lss/...`) as the local project root in the UI, not `C:\...`. Tier 1 Electron is unchanged — it still uses the native PHP sidecar on the host.

**Happy path — Docker, infra only (native API):**

```sh
docker compose up -d postgres redis
cd apps/api
cp .env.example .env && php artisan key:generate
php artisan migrate --seed
```

`docker-compose.yml` provisions Postgres (`lss` / `lss` / database `lss` on port 5432) and Redis on 6379.

**SQLite — CI/Pest only, do not use for `artisan serve` or queue workers.**
`phpunit.xml` already points Pest at an in-memory SQLite DB; no setup needed
to run tests.

No demo data is seeded — the app starts empty and real projects are registered at runtime via the Explore import flow or **Link & analyze on disk** in Settings.

### Run the apps

```sh
# full stack (postgres + redis + api + worker) — see "Docker" under Database
docker compose up -d --build

# or infrastructure only (native php artisan serve on host)
docker compose up -d postgres redis

# api — raise PHP upload limits for folder imports (default 2M is too small)
cd apps/api
php -d upload_max_filesize=512M -d post_max_size=512M artisan serve   # http://127.0.0.1:8000 — /api/v1/health
# Required when QUEUE_CONNECTION=database|redis (default in .env.example):
#   php artisan queue:listen --timeout=660
# `DB_QUEUE_RETRY_AFTER` / `REDIS_QUEUE_RETRY_AFTER` default to 720s in config (must stay above the 660s job timeout).
# Self-contained desktop (`cd apps/desktop && npm start`, no LSS_API_TOKEN) spawns API + queue worker together.
# Optional Redis speed pack: docker compose up -d redis, then QUEUE_CONNECTION=redis CACHE_STORE=redis
# PHPStan: shards + cache-dir on by default; set PHPSTAN_DEEP=true for CI3 system/ Wave B

# issue a Sanctum token for the web UI
php artisan token:issue jean@lss.local --label=web

# web (Vite proxies /api → :8000)
cd apps/web
npm install
npm run dev
```

Paste the token in **Settings**. Set **Local project root** to your program folder on disk, then use **Link & analyze on disk** (no upload) or drop a folder on **Explore**.

## Local folder linking (Obsidian-style)

When the API runs on the same machine as your code (`php artisan serve`), register the absolute path instead of uploading a zip:

1. Settings → **Local project root** → e.g. `C:\Projects\my-app`
2. **Link & analyze on disk** (or drop a folder on Explore after saving the path)

The API scans that folder in place (ignore rules apply). No size limit beyond disk space and scan time. Disable in hosted deployments with `SANDBOX_ALLOW_LOCAL_LINK=false`.

Optional: restrict paths with `LOCAL_PATH_PREFIXES=C:\LSS;C:\Projects` in `apps/api/.env`.

## Diagnostics (PHPStan)

PHPStan runs from the **Maintain API**, not from each linked program:

```sh
cd apps/api
composer install   # installs vendor/bin/phpstan (already in composer.json)
```

After linking/importing a project, use **Re-scan** on Health. Diagnose distinguishes:

- **missing binary** — `composer install` was not run in `apps/api`
- **clean** — PHPStan ran and found nothing (static analysis only)
- **findings** — real analyser output with ruleId + file + line

Optional (not required for Maintain): to run PHPStan yourself inside a company program:

```sh
cd <your-program>
composer require --dev phpstan/phpstan
```

## Workflow

Tasks, acceptance criteria and the claim convention are in the vault Roadmap
("How agents work this project"). Commits reference task IDs. Definition of done
includes the pre-merge checklist in vault note `09 Engineering Standards`.
