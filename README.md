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

**Postgres without Docker (Daniel's machine — done, Postgres 16):** install [PostgreSQL 16+](https://www.postgresql.org/download/windows/), then as the postgres superuser: `CREATE ROLE lss LOGIN PASSWORD 'lss'; CREATE DATABASE lss OWNER lss;` and set the `DB_*` values in `apps/api/.env` (`DB_CONNECTION=pgsql`, host 127.0.0.1:5432, db/user/password `lss`).

No demo data is seeded — the app starts empty and real projects are registered at runtime via the Explore import flow or **Link & analyze on disk** in Settings.

### Run the apps

```sh
# infrastructure (optional — postgres/redis only)
docker compose up -d

# api — raise PHP upload limits for folder imports (default 2M is too small)
cd apps/api
php -d upload_max_filesize=512M -d post_max_size=512M artisan serve   # http://127.0.0.1:8000 — /api/v1/health
# if QUEUE_CONNECTION is not sync, also: php artisan queue:listen

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
