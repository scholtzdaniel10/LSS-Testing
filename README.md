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

```sh
# infrastructure (needs Docker; optional early on — see CLAUDE.md fallback)
docker compose up -d

# api
cd apps/api
composer install
cp .env.example .env && php artisan key:generate
php artisan serve          # http://127.0.0.1:8000 — service health at /api/v1/health

# web
cd apps/web
npm install
npm run dev
```

## Workflow

Tasks, acceptance criteria and the claim convention are in the vault Roadmap
("How agents work this project"). Commits reference task IDs. Definition of done
includes the pre-merge checklist in vault note `09 Engineering Standards`.
