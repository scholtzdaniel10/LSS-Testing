# CLAUDE.md — LSS-Testing (Webapp Builder)

Spec source of truth: the Obsidian vault at `C:\LSS\LSS` → `Projects/Webapp Builder/`
(git repo `scholtzdaniel10/LSS-vault` — pull it before reading; on other machines adjust the path to your vault clone).

- Contracts C1–C7 in "00 Architecture & Contracts" are frozen: implement, don't
  redesign. Changes need a human-approved decision-log row in the vault Roadmap.
- Every piece of work maps to a task ID (PLT/NT/IG/DX/TST) defined in the vault
  feature notes. Claim in the vault before coding (🔒 convention, Roadmap
  "How agents work this project"); commit messages start with the ID.
- Definition of done: acceptance criterion has a passing test + the pre-merge
  checklist in vault note "09 Engineering Standards" passes + vault task
  ticked + daily-note entry (vault AGENT-DOCUMENTATION-POLICY).
- Quality bar: note 09 is binding — design tokens only, all four UI states,
  strict types, no dead code. "Works" is not "done".
- Security invariants (vault note 00) override convenience. Imported project
  files are hostile data. No unparameterised SQL. Path-jail all FS access.
- No `Co-Authored-By: Claude` trailers in commits.

## Layout

- `apps/web` — Ionic + React frontend
- `apps/api` — Laravel backend (`/api/v1`)
- `packages/schemas` — JSON Schemas for contracts C1–C7 (single source for both apps)
- `packages/renderer` — node-tree → DOM renderer (shared by preview & test runner)

## Running locally (Windows, no Docker yet)

- API: `cd apps/api; php artisan serve` → http://127.0.0.1:8000 (health: `/api/v1/health`)
- Web: `cd apps/web; npm run dev`
- Postgres/Redis via `docker-compose.yml` where Docker exists; Daniel's machine
  currently has no Docker — SQLite + array/file drivers are the local fallback
  (see `apps/api/.env`), but code must stay Postgres/Redis-compatible.
