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

## Security model (one paragraph, non-negotiable)

Imported program sources are **data, never code**: they are parsed in a
path-jailed sandbox and never executed. The only execution surface is the
company program's **own** dev/staging URL, registered per project, which the
Playwright runner drives. No credentials are persisted for targets.

## Local development

### Database

The API supports **SQLite** (default, no setup) and **Postgres** (Iteration 1 target).

**SQLite (fastest start — matches CI):**

```sh
cd apps/api
composer install   # or: php composer.phar install
cp .env.example .env && php artisan key:generate
touch database/database.sqlite   # Windows: New-Item database/database.sqlite -ItemType File
php artisan migrate --seed
```

**Postgres (with Docker, when available):**

```sh
docker compose up -d postgres redis
cd apps/api
cp .env.example .env && php artisan key:generate
# Set DB_CONNECTION=pgsql and uncomment DB_HOST/DB_PORT/DB_DATABASE/DB_USERNAME/DB_PASSWORD
php artisan migrate --seed
```

`docker-compose.yml` provisions Postgres 17 (`lss` / `lss` / database `lss` on port 5432) and Redis on 6379.

**Postgres without Docker (Daniel's machine):** install [PostgreSQL 17](https://www.postgresql.org/download/windows/), create database `lss` and user `lss`, then set `DB_CONNECTION=pgsql` in `apps/api/.env`.

Seeded demo project: `lexpro-portal` (matches the v0 preview mock data shapes).

### Run the apps

```sh
# infrastructure (optional — postgres/redis only)
docker compose up -d

# api
cd apps/api
php artisan serve          # http://127.0.0.1:8000 — service health at /api/v1/health
# if QUEUE_CONNECTION is not sync, also: php artisan queue:listen

# issue a Sanctum token for the web UI
php artisan token:issue jean@lss.local --label=web

# web (Vite proxies /api → :8000)
cd apps/web
npm install
npm run dev
```

Paste the token in **Settings**. Seeded demo project: `lexpro-portal`. Drag a folder on **Explore** to import (ignore rules strip node_modules/vendor/dist/.git/.angular client-side).

## Workflow

Tasks, acceptance criteria and the claim convention are in the vault Roadmap
("How agents work this project"). Commits reference task IDs. Definition of done
includes the pre-merge checklist in vault note `09 Engineering Standards`.
