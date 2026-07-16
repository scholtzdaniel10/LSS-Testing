# LSS-Testing — Webapp Builder

A visual development environment: build webapps in a drag-drop node-tree editor,
import existing apps into an Obsidian-like dependency graph, diagnose errors by
following the pipeline, and generate Pest/Playwright tests from the UI itself.

**The spec lives in the shared Obsidian vault** (`scholtzdaniel10/LSS-vault`,
`Projects/Webapp Builder/`) — architecture & contracts, feature milestones with
task IDs, UI map, data model, engineering standards. This repo is the
implementation. Agents: read `CLAUDE.md` first.

## Layout

| Path | What |
|---|---|
| `apps/web` | Ionic + React frontend |
| `apps/api` | Laravel backend (`/api/v1`) |
| `packages/schemas` | JSON Schemas for contracts C1–C7 |
| `packages/renderer` | Node-tree → DOM renderer (NT-11) |

## Local development

```sh
# infrastructure (needs Docker; optional early on — see CLAUDE.md fallback)
docker compose up -d

# api
cd apps/api
composer install
cp .env.example .env && php artisan key:generate
php artisan serve          # http://127.0.0.1:8000 — health at /api/v1/health

# web
cd apps/web
npm install
npm run dev
```

## Workflow

Tasks, acceptance criteria and the claim convention are in the vault Roadmap
("How agents work this project"). Commits reference task IDs. Definition of done
includes the pre-merge checklist in vault note `09 Engineering Standards`.
