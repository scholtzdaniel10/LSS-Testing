# Epic: scale the Graph and Map views for big codebases

**Status:** Proposed · **Track:** IG (Import & Graph) · **Proposed ids:** IG-30 … IG-35
(provisional — confirm/claim each in the vault Roadmap before coding)

> All task ids below (`IG-30`..`IG-35`) are **proposed**. The vault is the source
> of truth for task numbering; the highest existing IG id seen in-repo is IG-27.
> Claim the real id in the vault Roadmap ("How agents work this project", 🔒
> convention) before writing code, and prefix commits with the claimed id.

> **Doc set:** this `README.md` is the **what/why** (problem, pipeline evidence,
> bottlenecks, sequencing, governance); the per-task `IG-3x-*.md` notes are the
> authoritative scope for each task; `IMPLEMENTATION.md` is the **how** (execution
> checklists, verify commands, the automation loop, rollback). Read this file, then
> the task note, then the playbook before touching code.

## Problem statement

The dependency **Graph** view (C3 snapshot) and the codebase **Map** (radial)
view were built for pilot-sized programs (~a few thousand files, ~6.2k edges).
They already have good *render-tier* machinery — draw caps, overview modes,
neighbourhood focus — but every stage **upstream of rendering** still processes
the whole project:

- Extraction parses at most **4000 files** even though the scanner indexes up to
  **25 000**, so on a large program most indexed files never contribute edges,
  and *which* 4000 win depends on ordering.
- The API ships the **entire** edge blob and the **entire** file list in single
  unpaginated responses.
- The client loads both blobs into React state and **recomputes the full model
  on the main thread every render** before the render caps even apply.

The result: on a big codebase the app is slow or unusable long before the
canvas draw caps help, because the cost is paid in extraction, transfer, and
main-thread compute — not in drawing.

## End-to-end pipeline & current-state evidence

```
 program on disk
      │
      ▼
 [1] Extraction        LocalDirectoryScanner (index ≤25k)  ─►  DependencyGraphBuilder (parse ≤4k)
      │                                                        (via IncrementalGraphBuilder per-file cache)
      ▼
 [2] Storage           graph_snapshots.edges  = ONE json/jsonb blob      project_files rows
      │
      ▼
 [3] Transfer          GET /graph → whole edges blob        GET /tree → whole file list
      │                (ProjectReadCache fronts both)
      ▼
 [4] Client model      ProjectContext holds full graphEdges + tree in React state
      │                buildGraphView / buildFolderLayout / buildRadialLayout recompute over ALL data
      ▼
 [5] Render            graphPerformanceProfile / radialPerformanceProfile + draw caps (MAX_NODES, tiers)
```

### [1] Extraction — coverage cap

- `apps/api/app/Services/Graph/DependencyGraphBuilder.php:18` —
  `private const MAX_FILES = 4000;`. Enforced in both `build()`
  (`DependencyGraphBuilder.php:105`) and `buildIndexed()`
  (`DependencyGraphBuilder.php:139`). Files larger than `512_000` bytes are
  skipped (`DependencyGraphBuilder.php:149`).
- `apps/api/app/Services/Import/LocalDirectoryScanner.php:18` —
  `private const MAX_FILES = 25_000;`. So the index can hold ~6× more files
  than extraction will ever parse. On a 25k-file program up to ~84% of indexed
  files never contribute graph edges.
- `apps/api/app/Jobs/AnalyzeProject.php:53-62` — selects paths whose `lang` is
  in `parseableLangs()`, calls `IncrementalGraphBuilder->buildIndexed(...)`, and
  stores **all** returned edges as one `graph_snapshots.edges` row.
- The 4000 cap is applied *after* the parseable-lang filter and in the order
  `project->files()->...->pluck('path')` returns rows — there is no explicit,
  documented deterministic parse ordering, so coverage under the cap is
  effectively arbitrary.

### [2] Storage — one blob, no aggregation

- `apps/api/database/migrations/2026_07_17_000001_create_maintenance_system_tables.php:34`
  — `graph_snapshots.edges` is a single `json` column.
- `apps/api/database/migrations/2026_07_20_000001_optimize_for_postgres.php:18-23,74-87`
  — converted to `jsonb` on Postgres; there is no server-side rollup/aggregate
  structure. Every consumer reads the whole document.
- Whole-blob consumers: `HealthSnapshotBuilder.php:28` (`->edges`),
  `ImpactResolver.php:33` (constructor takes the full edge list),
  `AnalysisRunner` / `ErrorController` via impact + chains.

### [3] Transfer — full payloads

- `apps/api/app/Http/Controllers/Api/V1/GraphController.php:15-39` — `show()`
  returns `{ projectId, scannedAt, edges }` with the **entire** edges blob
  (fronted by `ProjectReadCache`).
- `apps/api/app/Http/Controllers/Api/V1/ProjectFileController.php:18-36` —
  `tree()` returns the **entire** file list unpaginated, only annotating
  `meta.count`.

### [4] Client model — full load + main-thread recompute

- `apps/web/src/state/ProjectContext.tsx:135-147` — `ensureExploreData()` does
  `Promise.all([api.graph(id), api.tree(id)])` and holds full `graphEdges` +
  `tree` in React state.
- `apps/web/src/api/client.ts:102` — `GraphEdge = { from, to, kind?, line? }`;
  `client.ts:256` (`graph`) and `client.ts:271` (`tree`) fetch the full blobs.
- Graph: `apps/web/src/components/DependencyGraph.tsx:132-135` calls
  `buildGraphView(...)` (`apps/web/src/lib/graphModel.ts:146`) in a `useMemo`,
  building **all** nodes/links then hard-capping to `MAX_NODES = 200`
  (`graphModel.ts:126`). Render tiers exist:
  `graphPerformanceProfile` (`graphModel.ts:476`),
  `HUGE_GRAPH_OVERVIEW_THRESHOLD = 100` (`graphModel.ts:550`),
  `hugeGraphOverviewKeep` (`graphModel.ts:556`), `cappedNeighbourhood`,
  `filterForceGraphData`, `pinAllNodes`, cluster layout — but they cap what is
  **drawn**, not what is loaded/computed.
- Map: `apps/web/src/components/CodebaseRadial.tsx:583-631` computes
  `buildFolderLayout` / `buildRadialLayout` (`apps/web/src/lib/radialModel.ts:603`,
  `radialModel.ts:216`) over **all** files+edges in `useMemo` on the main thread
  (union-find `radialModel.ts:65-110`, hierarchy build `radialModel.ts:120-150`),
  then applies `radialPerformanceProfile` (`radialModel.ts:456`) +
  `applyRadialRenderCap` (`radialModel.ts:547`). Caps: `LABEL_THRESHOLD = 40`
  (`radialModel.ts:408`), tiers small/medium/large/huge.
- The Node-tree panel maps **all** `treeNodes` to DOM rows
  (`apps/web/src/pages/ExplorePage.tsx:266-324`) with no virtualization.

### [5] Render — already tiered (leave mostly as-is)

The draw-cap machinery in `graphModel.ts` and `radialModel.ts` is sound and is
reused, not replaced. The epic feeds it *pre-aggregated / pre-focused* data so it
no longer sits behind a full-project compute.

## Bottleneck summary

| # | Stage | Symptom on big codebases | Evidence | Fixed by |
|---|---|---|---|---|
| 1 | Extraction | ≤4k of ≤25k files parsed; arbitrary coverage | `DependencyGraphBuilder.php:18,105,139` vs `LocalDirectoryScanner.php:18` | IG-30 |
| 2 | Storage/transfer | whole edge blob per request | `GraphController.php:15-39`, migration `:34` | IG-31 |
| 3 | Transfer | whole file list per request | `ProjectFileController.php:18-36` | IG-32 |
| 4 | Client load | full `graphEdges`+`tree` in state | `ProjectContext.tsx:135-147` | IG-33, IG-34 |
| 5 | Client compute | full model rebuilt on main thread every render | `DependencyGraph.tsx:132`, `CodebaseRadial.tsx:583-631` | IG-33 |
| 6 | Render (tree) | all rows mounted to DOM | `ExplorePage.tsx:266-324` | IG-33 |
| 7 | Progressive UX | no folder→drill fetch path | `CodebaseRadial.tsx`, `DependencyGraph.tsx` | IG-34 |

## Sequenced plan & dependency graph

```
 IG-30 ─────────────┐  (more/better edges to aggregate over)
 (extraction cover) │
                    ▼
 IG-31 ── server-side graph aggregation ──┐
 (rollup/neighbourhood/top-N)             │
                                          ├──► IG-34 progressive drill-down UI
 IG-32 ── lazy/paginated tree ────────────┘        (Map + Graph consume new APIs)
 (children/pagination)

 IG-33 ── client off-thread model + tree virtualization
 (Web Worker + memo cache; partly independent — can land against today's APIs)

 IG-35 ── scale perf harness (synthetic fixture + CI budgets)
 (validates all of the above; author skeleton early, tighten as tasks land)
```

Recommended order and rationale:

1. **IG-30** first — the aggregation in IG-31 is only worth as much as the edge
   coverage it summarises. Bound analysis time while raising the cap.
2. **IG-31** and **IG-32** next — additive backend endpoints that let the client
   stop pulling whole blobs. Independent of each other; both unblock IG-34.
3. **IG-33** in parallel — it needs no backend change (moves today's compute to a
   worker and virtualizes the tree). Delivers a win even before IG-34.
4. **IG-34** last of the feature work — wires Map + Graph to the IG-31/IG-32 APIs
   for true progressive loading. Depends on IG-31 (and benefits from IG-32).
5. **IG-35** spans the epic — stand up the synthetic fixture + CI budgets early so
   each task can assert its own bound; tighten thresholds as tasks land.

## Governance (read before coding)

- **Frozen contracts C1–C7** (`CLAUDE.md`, vault note "00 Architecture &
  Contracts" v1): implement, don't redesign. The Graph view is the **C3**
  dependency-edge contract (`packages/schemas/dependency-edge.schema.json`).
- The existing `GET /graph` and `GET /tree` **response shapes are contract
  surfaces** consumed by the web client. Every change here must be **additive and
  backward-compatible**:
  - Prefer **new endpoints** and **new additive `meta` fields** over changing the
    existing `data` shapes.
  - Any change to an existing response body (including adding fields inside the
    C3 edge object, or altering `/graph`'s `data`) requires a **human-approved
    decision-log row in the vault Roadmap + a schema version bump in vault note
    00 + a task claim** before coding. Flag it in the task's Governance section.
- API envelope is fixed by **C7**: `{ data, meta, errors }` via
  `apps/api/app/Http/Controllers/Api/V1/Controller.php` (`respond()`,
  `respondPaginated()`); all routes under `/api/v1`
  (`apps/api/routes/api.php`). New endpoints MUST use this envelope and prefix.
- **Security invariants** (vault note 00) override convenience and apply to every
  task: imported program files are hostile **data** — parse, never execute; the
  registered target URL (C1) is the only execution surface; **no unparameterised
  SQL** (the `sql-safety` CI gate rejects string-built SQL —
  `.github/workflows/ci.yml:51-69`); **path-jail** all filesystem access
  (`ProjectWorkspace::resolve`); never persist target credentials.
- New JSON payload shapes that formalise a contract belong in
  `packages/schemas` (see `packages/schemas/README.md`); wiring schemas into
  both apps is the pre-existing PLT-9 concern — reference it, don't duplicate it.

## How the every-4-hours automation should consume this epic

Each automation run should:

1. Pick the **next unblocked task** by the dependency order above (a task is
   unblocked when all its "Depends on" tasks are merged). Prefer earlier tasks;
   IG-33 and IG-35's skeleton can run in parallel with IG-30/31/32.
2. Do **one task per run**. These are scoped so a single run can land one task
   with its tests.
3. **Claim the real task id in the vault Roadmap first** (the proposed id here is
   provisional). If a task would touch a frozen contract surface (see
   Governance), stop and add the required decision-log row before coding.
4. Commit with the **claimed id prefix** (e.g. `IG-31: …`); **no
   `Co-Authored-By: Claude` trailer**.
5. Satisfy the Definition of done (below) before considering the task complete.

## Definition of done (per task, aligned to vault note 09)

- Every acceptance criterion has a **passing automated test** (Pest for API,
  vitest for web) — mirror the existing test files named in each task.
- The vault pre-merge checklist in note "09 Engineering Standards" passes:
  **design tokens only** (no hardcoded colours/spacing), **all four UI states**
  (idle / loading / ready / empty / error) for any UI, **strict types** (web
  `tsc` strict; PHP typed signatures), **no dead code**.
- CI green: API Pint + Pest; web eslint + `npm run test.unit` + `npm run build`
  (tsc strict); `sql-safety` gate (`.github/workflows/ci.yml`).
- Vault task ticked + daily-note entry (vault AGENT-DOCUMENTATION-POLICY).
- Contract impact flagged and, where a frozen surface changes, a decision-log row
  exists before merge.

## Task index

| Proposed id | Title | Depends on | One-line scope |
|---|---|---|---|
| IG-30 | Graph extraction coverage | — | Raise/remove the 4k parse cap with a bounded time/memory budget + deterministic ordering + `coverage`/`truncated` signal |
| IG-31 | Server-side graph aggregation | IG-30 | Additive folder-rollup, node-neighbourhood, and top-N subgraph endpoints so the client never needs the full edge set |
| IG-32 | Lazy tree endpoint | — | Additive lazy/paginated tree API (children-of-path + pagination) with `count`/`truncated` |
| IG-33 | Client off-thread model | — | Move `buildGraphView`/radial layout/union-find into a Web Worker, memoize by snapshot id, virtualize the Node tree |
| IG-34 | Progressive drill-down UI | IG-31 (+IG-32) | Map + Graph start at an overview and fetch neighbourhood/children on demand |
| IG-35 | Scale perf harness | IG-30/31/33 | ~20k-file/~60k-edge fixture + backend/web perf budgets wired into CI |
