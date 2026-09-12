# Implementation playbook — Graph & Map at scale

**Track:** IG · **Covers:** IG-30 … IG-35 · **Status:** Proposed (ids provisional)

Execution-focused companion to the plan docs in this folder. The **what/why**
lives in `README.md` and the per-task `IG-3x-*.md` notes; this file is the
**how**: sequencing, per-task checklists, verify commands, the automation loop,
and rollback.

## 0. How to read this playbook

- Read `README.md` first (problem statement, pipeline evidence, bottleneck
  table, governance). Then read the specific `IG-3x-*.md` task note before you
  touch code — the task note owns the authoritative problem, acceptance
  criteria, and file list; this playbook does not restate them, it operationalises
  them.
- **Provisional ids caveat:** `IG-30`..`IG-35` are *proposed*. The vault Roadmap
  is the source of truth for numbering (highest in-repo id seen is IG-27). Claim
  the real id in the vault **before** coding and prefix commits with the claimed
  id. Where this file writes `IG-3x:` it means "the claimed id for that task".
- Everything here is subordinate to `/workspace/CLAUDE.md` and vault notes "00
  Architecture & Contracts" (frozen C1–C7) and "09 Engineering Standards"
  (definition of done / quality bar).

## 1. Execution sequencing

Dependency graph (arrows = "must merge before"):

```
 IG-30 ──► IG-31 ──►┐
 (extraction cover)  ├──► IG-34  (progressive drill-down UI)
 IG-32 ─────────────┘
 (lazy tree)

 IG-33  (client off-thread + virtualization)   — parallel, no backend dep
 IG-35  (scale perf harness)                    — spans epic; skeleton early
```

| Task | Title | Depends on | Unblocks | Parallelisable? |
|---|---|---|---|---|
| IG-30 | Graph extraction coverage | — | IG-31, IG-35 | Runs first |
| IG-31 | Server-side graph aggregation | IG-30 | IG-34 | With IG-32, IG-33 |
| IG-32 | Lazy tree endpoint | — | IG-34 | With IG-31, IG-33 |
| IG-33 | Client off-thread model | — | (delivers standalone win) | Fully parallel |
| IG-34 | Progressive drill-down UI | IG-31 (+IG-32) | — | Last feature task |
| IG-35 | Scale perf harness | IG-30/31/33 | — | Skeleton early, tighten later |

- **Recommended first task:** **IG-30**. Aggregation (IG-31) is only worth the
  coverage it summarises, so raise/bound extraction before building rollups.
- **Critical path:** `IG-30 → IG-31 → IG-34`. IG-32 is a shorter side-branch
  that also feeds IG-34. IG-33 and the IG-35 skeleton can start immediately in
  parallel with the backend work.
- **One task per automation run** (see §4). Pick the earliest *unblocked* task
  in the table above.

## 2. Per-task implementation checklists

Each checklist is ordered, grounded in the real symbols the task notes cite, and
ends with the exact CI-equivalent verify commands (see §5 for the shared
command reference). "Additive" everywhere means **new endpoint / new nullable
column / new `meta` field**, never a changed `data`/edge shape (C3/C7).

### IG-30 — Graph extraction coverage

Files: `apps/api/app/Services/Graph/DependencyGraphBuilder.php`
(`MAX_FILES = 4000`, `build()`, `buildIndexed()`, 512_000-byte guard),
`apps/api/app/Services/Import/LocalDirectoryScanner.php` (`MAX_FILES = 25_000`),
`apps/api/app/Jobs/AnalyzeProject.php` (candidate query L53-62, `warmReadCaches`),
`apps/api/app/Http/Controllers/Api/V1/GraphController.php` (`show`, meta),
new `apps/api/config/graph.php`, additive migration on `graph_snapshots`.

1. Add `apps/api/config/graph.php` with `max_parse_files` (default `25000`) and
   `max_parse_seconds` (default `120`), mirroring `config/speed.php` /
   `config/sandbox.php`. Read via `config('graph.max_parse_files')`.
2. Replace the hard `MAX_FILES = 4000` const usage in `build()` and
   `buildIndexed()` with the config ceiling. **Keep** `strlen($source) > 512_000`
   skip (parse-not-execute + size guard preserved).
3. Add a wall-clock + parsed-count budget inside `buildIndexed()`; stop cleanly
   when either bound trips and mark the result truncated. Keep the budget below
   `AnalyzeProject::$timeout = 660` / `@set_time_limit(600)`.
4. Deterministic ordering: add `->orderBy('path')` to the candidate query in
   `AnalyzeProject.php` (uses the existing `project_files (project_id, path
   text_pattern_ops)` index — query builder, no raw SQL) **and** defensively
   `sort()` paths in `buildIndexed()` so the legacy `build()` path is stable too.
5. Return a coverage report **without breaking the `list<edge>` return**: add a
   companion `lastCoverage(): array{parsed,eligible,skipped,truncated}` rather
   than changing the return type (keeps `IncrementalGraphBuilder::buildIndexed`
   per-file cache and existing tests intact).
6. Persist coverage: additive **nullable** column on `graph_snapshots`
   (guard Postgres-specific types; keep SQLite/Pest green like
   `2026_07_20_000001_optimize_for_postgres.php`); cast it in
   `apps/api/app/Models/GraphSnapshot.php` if chosen.
7. Surface additively: in `GraphController::show` pass `truncated`/`coverage` in
   the **`meta`** arg of `respond($data, $meta)` — never inside `data`/edges.
   Mirror the same meta into `AnalyzeProject::warmReadCaches` for cache parity.

Tests (mirror `apps/api/tests/Unit/DependencyGraphBuilderTest.php` temp-dir style):
coverage-past-old-4000-cap; byte-identical ordered edges on re-parse
(determinism); budget-truncation reports `truncated:true` + `parsed`/`eligible`
and the job still completes; >512_000-byte file still skipped. Add a Feature/Pest
test that `GET /graph` returns `meta.truncated`/`meta.coverage` and `data` is
byte-identical when not truncated (mirror existing `apps/api/tests/Feature`).

Verify: `pint --test` + `pest --ci` (API commands, §5). No web build needed.

Contract impact: **none** while coverage stays in `meta` (C7 free-form). Putting
coverage inside `/graph` `data` or the C3 edge object → **vault decision-log row
+ C3 bump in note 00 + schema change in `packages/schemas/dependency-edge.schema.json`
first**.

### IG-31 — Server-side graph aggregation (additive endpoints)

Moves rollup/ranking the client does today
(`apps/web/src/lib/graphModel.ts` `buildGraphView` `MAX_NODES=200`,
`hugeGraphOverviewKeep`, `cappedNeighbourhood`) to the server.

1. Add **new** authed routes under the `/v1` `auth:sanctum` group in
   `apps/api/routes/api.php` (next to `GET /projects/{project}/graph`). Do **not**
   alter the existing `/graph` route/shape. Suggested additive routes:
   folder/module-rollup graph, node-neighbourhood subgraph (N hops, capped +
   ranked), top-N overview subgraph. Reuse `throttle:expensive` like siblings.
2. Implement aggregation as a service that reads the stored edges blob once
   (mirror the client rollup/ranking logic so results match today's views) and
   returns already-capped, already-ranked nodes/links. Port union-find/ranking
   semantics rather than inventing new ones.
3. Return via the base controller: `respond($data, $meta)` /
   `respondPaginated(...)`; envelope `{data,meta,errors}` (C7). Put caps/counts
   (`truncated`, `nodeCount`, `hops`) in `meta`.
4. Keep parse-not-execute (reads stored edges only), no raw SQL (query builder /
   in-PHP aggregation), path-jail any file access.

Tests: Pest feature tests per route (rollup counts, neighbourhood hop cap,
top-N ranking, envelope shape, empty/absent-snapshot → empty `data` not error).
If a formal graph payload schema is warranted, add it under `packages/schemas`
and reference PLT-9 for wiring (don't duplicate wiring).

Verify: `pint --test` + `pest --ci` (§5).

Contract impact: new endpoints are additive → no frozen-contract change. If a
new aggregation payload becomes a formalised contract, add the schema in
`packages/schemas` (new file = additive). Flag in the task's Governance section.

### IG-32 — Lazy/paginated tree endpoint

`apps/api/app/Http/Controllers/Api/V1/ProjectFileController.php` `tree()` returns
**all** files unpaginated today.

1. Add an **additive** route (new path) for lazy children-of-folder and/or
   paginated tree; **keep** the existing `GET /projects/{project}/tree` untouched
   for back-compat until web migrates (IG-34).
2. Return `count`/`truncated` in `meta`; use `respondPaginated()` for the
   paginated variant (envelope C7). Path-jail all path inputs
   (`ProjectWorkspace::resolve`); reject traversal.
3. No raw SQL — query builder with bound params only (sql-safety gate).

Tests: Pest feature tests — children-of-path returns only that folder's children;
pagination boundaries + `meta.count`/`truncated`; path-jail rejects `../` escape;
existing `/tree` response unchanged. Mirror existing `ProjectFileController`
feature tests under `apps/api/tests/Feature`.

Verify: `pint --test` + `pest --ci` (§5).

Contract impact: additive route → none. Legacy `/tree` stays byte-identical.

### IG-33 — Client off-thread model + virtualization

Files: `apps/web/src/lib/graphModel.ts` (`buildGraphView`, `graphPerformanceProfile`),
`apps/web/src/lib/radialModel.ts` (`buildRadialLayout`/`buildFolderLayout`,
union-find, hierarchy build), `apps/web/src/state/ProjectContext.tsx`
(`ensureExploreData`), `apps/web/src/components/DependencyGraph.tsx`,
`apps/web/src/components/CodebaseRadial.tsx`, `apps/web/src/pages/ExplorePage.tsx`
(un-virtualized Node tree rows).

1. Move `buildGraphView`, `buildRadialLayout`/`buildFolderLayout`, union-find and
   hierarchy building into a **Web Worker**; keep pure functions importable so
   unit tests still call them directly.
2. Memoize/cache worker results keyed by **snapshot id + view params** so
   `DependencyGraph.tsx` and `CodebaseRadial.tsx` stop recomputing over full
   arrays every render.
3. Virtualize the Node-tree list in `ExplorePage.tsx` (only mount visible rows).
4. Preserve all **four+ UI states** (idle/loading/ready/empty/error) — the worker
   adds a real async boundary, so the loading state must be genuine. **Design
   tokens only**, **strict TS**, no dead code.

Tests (mirror `apps/web/src/lib/graphModel.test.ts`,
`apps/web/src/lib/radialModel.test.ts`): worker-boundary correctness (worker
output === direct pure-fn output for a fixture); memo cache hit on identical
snapshot id + params; virtualization renders a bounded row count for a large
tree.

Verify: `npm run lint` + `npm run test.unit` + `npm run build` (web commands, §5).
Manual: exercise Graph + Map with a large project and confirm the four UI states.

Contract impact: client-only → none.

### IG-34 — Progressive drill-down UI

Depends on IG-31 (+IG-32). Make Map + Graph consume the new APIs.

1. Add typed API client methods in `apps/web/src/api/client.ts` for the IG-31
   aggregation endpoints and IG-32 lazy-tree endpoint (envelope `{data,meta,errors}`).
2. In `ProjectContext.tsx` (`ensureExploreData`) start at folder/module
   **overview** instead of `Promise.all([api.graph(id), api.tree(id)])` over full
   blobs; fetch neighbourhood/subgraph/children **on demand**.
3. Wire `DependencyGraph.tsx` and `CodebaseRadial.tsx` to request focused data as
   the user drills; keep the render-cap tiers (`graphPerformanceProfile`,
   `radialPerformanceProfile`) — they now sit behind pre-focused data.
4. Preserve UX: search, focus-depth, expand/collapse breadcrumbs, Map/Graph
   toggle, design-token styling, all four UI states, strict TS.
5. Keep legacy `/graph`+`/tree` calls available until this task fully lands
   (rollback lever).

Tests (mirror `graphModel.test.ts`/`radialModel.test.ts` + component patterns):
overview→drill fetch sequence; neighbourhood fetch on node focus; empty/error
states for the new fetches; search/focus-depth still function.

Verify: `npm run lint` + `npm run test.unit` + `npm run build` (§5). Manual:
drill-down on a large project; confirm the whole project no longer loads up-front.

Contract impact: consumes additive endpoints → none. Do not change existing
`data` shapes.

### IG-35 — Scale perf harness (TST track)

1. Add a large synthetic fixture (~20k files / ~60k edges) under
   `apps/api/tests/fixtures/` (generator or committed tree; follow existing
   fixture conventions there, e.g. `ci3-mini`, `mixed-lang`).
2. Backend bounds assertions (Pest): extraction (IG-30) parses within budget and
   reports coverage; aggregation (IG-31) returns capped results within a time
   bound.
3. Web assertions (vitest): model-build time budget for `buildGraphView`/radial;
   worker correctness (IG-33); virtualization row-count bound. Mirror
   `apps/web/src/lib/graphModel.test.ts` / `radialModel.test.ts`.
4. Wire into CI (`.github/workflows/ci.yml`) alongside the existing API/web jobs;
   stand up the skeleton early and tighten thresholds as IG-30/31/33 land.

Verify: `pint --test` + `pest --ci` (API) and `npm run test.unit` (web) (§5).

Contract impact: tests/fixtures only → none.

## 3. Contract & security invariant checklist (every task)

- Envelope C7: all new routes use `{data,meta,errors}` via the base controller
  (`respond`/`respondPaginated` in
  `apps/api/app/Http/Controllers/Api/V1/Controller.php`) under `/api/v1`
  (`apps/api/routes/api.php`).
- C3 edge shape (`packages/schemas/dependency-edge.schema.json`) is **frozen** —
  additive `meta`/new endpoints only. Any `data`/edge-shape change needs a
  vault decision-log row + note-00 bump + schema change **before coding**.
- Imported program files are hostile **data**: parse, never execute; only the
  registered target URL (C1) is an execution surface.
- No unparameterised SQL — query builder / bound params only (`sql-safety` gate,
  `.github/workflows/ci.yml`). Path-jail all FS access
  (`ProjectWorkspace::resolve`). Never persist target credentials.

## 4. Reusable per-task workflow (every-4-hours automation)

Run this loop **once per run**, for a **single** task:

1. **Pick** the earliest *unblocked* task from the §1 table (a task is unblocked
   when every "Depends on" task is merged). IG-33 and the IG-35 skeleton may be
   picked in parallel with backend tasks.
2. **Claim the id** in the vault Roadmap first (🔒 convention). If the task would
   touch a frozen contract surface, **stop** and add the decision-log row before
   coding.
3. **Branch:** `git checkout -b cursor/<id-slug>-<suffix>` off `main`
   (e.g. `cursor/ig-31-graph-aggregation-<suffix>`).
4. **Implement + add tests** per the task checklist in §2. Keep it additive and
   back-compatible; keep old endpoints alive until web migrates.
5. **Run CI-equivalent checks locally** (§5) until green.
6. **Commit** with the **claimed id prefix** (`IG-31: …`); **no
   `Co-Authored-By: Claude` trailer**; one commit per logical change.
7. **Open a DRAFT PR to `main`.** Do **not** merge.
8. **Stop.** Tick the vault task + add the daily-note entry per
   AGENT-DOCUMENTATION-POLICY.

### Copy-pasteable Definition of Done (vault note 09)

```
[ ] Every acceptance criterion in the IG-3x task note has a passing test
    (Pest for API, vitest for web), mirroring the named existing test files
[ ] Web UI: all four+ states present (idle/loading/ready/empty/error)
[ ] Design tokens only (no hardcoded colours/spacing)
[ ] Strict types (web tsc strict; PHP typed signatures)
[ ] No dead code
[ ] sql-safety: no string-built SQL (bound params only)
[ ] Contract check: additive only; frozen-surface change has a vault
    decision-log row + note-00 bump + packages/schemas change BEFORE coding
[ ] CI green: pint --test + pest --ci (API); lint + test.unit + build (web)
[ ] Vault task ticked + daily-note entry written
[ ] Commit prefixed with claimed id; no Co-Authored-By: Claude trailer
```

## 5. Environment / setup quickstart & verify commands

API (`apps/api` — Laravel 13 / PHP 8.4):

```
cd apps/api
composer install
cp .env.example .env
php artisan key:generate
php artisan migrate --seed        # Postgres is source-of-truth; SQLite is Pest-only via phpunit.xml
php artisan serve                 # http://127.0.0.1:8000 — health: /api/v1/health
php artisan queue:listen --timeout=660   # import/analyze are QUEUED jobs — required for graph/map output
```

Web (`apps/web` — Ionic + React + Vite):

```
cd apps/web
npm ci
npm run dev                        # Vite proxies /api → :8000
```

CI-equivalent verify (must be green before commit):

```
# API
cd apps/api && ./vendor/bin/pint --test && ./vendor/bin/pest --ci
# Web
cd apps/web && npm run lint && npm run test.unit && npm run build   # build = tsc strict
# sql-safety runs in CI (.github/workflows/ci.yml) — keep all SQL parameterised
```

Run the queued analyze pipeline to see Graph/Map output: start `php artisan serve`
**and** `php artisan queue:listen`, import/link a project via the web app, wait for
the queued `AnalyzeProject` job (`apps/api/app/Jobs/AnalyzeProject.php`) to build the
`graph_snapshots` row, then open the project's Explore page (Graph + Map).

## 6. Risks & rollback

- **Feature/config gates:** gate large behaviour behind config, mirroring the
  existing speed flags in `apps/api/.env.example`
  (`SPEED_INCREMENTAL_GRAPH`, `SPEED_FINDINGS_BUFFER`, `SPEED_SKIP_USAGE_REBUILD`).
  IG-30 ships its ceiling/budget as `config('graph.*')` — a bad value is a config
  revert, not a code revert. Keep the incremental per-file cache
  (`IncrementalGraphBuilder`) on so re-scans only reparse changed files.
- **Keep old endpoints:** IG-31/IG-32 are additive; `/graph` and `/tree` stay
  live until IG-34 migrates the web client. Reverting a UI task doesn't strand
  the client.
- **Additive migrations:** IG-30's coverage column is nullable/additive — safe to
  leave in place if the feature is reverted; guard Postgres-specific types so
  SQLite/Pest stays green.
- **Reverting a task:** because each task is one draft PR to `main` with additive
  surfaces, revert = close/revert that PR (or flip its config gate). No frozen
  `data` shape changed, so consumers are unaffected. IG-35 thresholds can be
  loosened independently if a bound is flaky.

## 7. Sequencing rationale

The cost on big codebases is paid **upstream of rendering**, so fix it in
pipeline order:

1. **Extraction cap (IG-30)** — ≤4k of ≤25k files parsed, arbitrary coverage.
   Raise + bound + make deterministic first; everything downstream summarises
   these edges, so more/better edges must exist before aggregation is meaningful.
2. **Transfer/aggregation (IG-31, IG-32)** — the API ships whole edge + file
   blobs. Add server-side rollup/neighbourhood/top-N and lazy/paginated tree so
   the client never needs the full set. Additive, independent, both feed IG-34.
3. **Client off-thread (IG-33)** — full model rebuilt on the main thread every
   render. Move it to a worker + memoize + virtualize the tree. No backend dep,
   so it can land in parallel and deliver a win immediately.
4. **Progressive UI (IG-34)** — with focused APIs available, start at overview
   and drill on demand instead of loading the whole project.
5. **Perf harness (IG-35)** — a ~20k-file/~60k-edge fixture + CI budgets proves
   each stage stays bounded; stand up the skeleton early and tighten as tasks land.
