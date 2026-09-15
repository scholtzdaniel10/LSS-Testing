# Epic: make diagnostics & health lightweight and easy to understand

**Status:** Proposed · planning only (no application code changes in this branch).

Companion epic to the graph/map scaling set (`docs/plans/graph-map-scale/`, a
**separate** branch `cursor/graph-map-scale-plans-fa1a` / PR #2 — do not fold the
two together). This set targets the diagnostics (DX) and health-dashboard (HD)
surfaces: the Diagnose page, the `/errors` endpoint, the C2 health snapshot, and
the analyzer adapters behind them.

## Problem statement

The diagnostics/health side is *light in output* today but carries five concrete
liabilities that make it slow on large repos and hard to reason about:

1. **Request-path cost cliffs.** `/errors` rebuilds an `ImpactResolver` from the
   full `graph_snapshots.edges` blob on *every* request and recomputes impact,
   then runs a second full-table chain query — impact/chains are already
   persisted at scan time, so this is redundant O(E) + O(rows) work per page.
2. **Noise, no grouping.** Findings are listed one-per-row with no server-side
   dedup/grouping into issues; the lowest tier is always shown; the web ignores
   the `depth` param and cursor pagination the API already supports.
3. **Hidden score.** The health `meta.formula` exists on `/health-report` but not
   on `bootstrap` (what the dashboard actually loads), so `HealthPage` never shows
   how the score is computed. Two different "chain" counts disagree between Health
   and Diagnose.
4. **Duplicated adapter code.** Each PHP adapter re-implements ~70–90 lines of
   decode → relative-path → range → taxonomy-classify → finding-array; a path/range
   bug must be fixed in three places.
5. **Monolithic Diagnose page.** `DiagnosePage.tsx` (~417 lines) inlines the row
   renderer, the impact popover, and the file-fetch effect in one component.

## Current-state evidence

| Area | Evidence (file:line) | Note |
| --- | --- | --- |
| Impact rebuilt per request | `apps/api/app/Http/Controllers/Api/V1/ErrorController.php:40`–`43`, `:64`–`69` | new `ImpactResolver($snapshot->edges)` + recompute per row |
| Second chain query per page | `apps/api/app/Http/Controllers/Api/V1/ErrorController.php:81`, `:90`–`109` | `chains()` full-table query each request |
| Persisted impact/chains exist | `apps/api/app/Services/Diagnostics/AnalysisRunner.php:174`–`200`; `apps/api/app/Jobs/AnalyzeProject.php:98` | upstream/downstream/chain_id written at scan time |
| Resolver O(E) constructor | `apps/api/app/Services/Diagnostics/ImpactResolver.php:33`–`51` | adjacency built from whole edge list |
| Chain detection O(N²) | `apps/api/app/Services/Diagnostics/ChainDetector.php:47`–`57` | pairwise union-find over errors |
| API already supports depth/filters/cursor | `apps/api/app/Http/Requests/ListErrorsRequest.php:23`–`32`; `ErrorController.php:52`–`53`, `:78` | `severity`/`kind`/`file`/`depth`(1–3)/cursor |
| Web ignores depth + pagination | `apps/web/src/state/ProjectContext.tsx:109`–`121`; `apps/web/src/pages/DiagnosePage.tsx` (whole file) | `api.errors(id)` first page, default depth=1, no UI |
| Two disagreeing "chain" counts | `apps/api/app/Services/HealthSnapshotBuilder.php:35`–`37` vs `ChainDetector` `chain_id` (`ErrorController.php:90`–`109`) | health heuristic ≠ Diagnose groups |
| `meta.formula` present but not on bootstrap | `apps/api/app/Http/Controllers/Api/V1/HealthReportController.php:32`; `BootstrapController.php:35`–`41` | bootstrap returns health without formula |
| Formula config | `apps/api/config/health.php:11`–`16`, `:42`–`46` | weights 0.35/0.25/0.20/0.20 + string |
| HealthPage never shows formula | `apps/web/src/pages/HealthPage.tsx` (whole file) | ScoreRing + TrendChart + tiles only |
| Health loads unbounded arrays | `apps/api/app/Services/HealthSnapshotBuilder.php:24`–`28` | all errors + full edges in memory |
| tests sub-score hardcoded 0 | `apps/api/app/Services/HealthSnapshotBuilder.php:44`–`46`, `:179` | pending TST work |
| Adapter duplication | `PhpStanAdapter.php` (446), `PhpcsAdapter.php` (203), `PhpmdAdapter.php` (218) | ~70–90 dup lines each |
| JS partial-failure hidden | `apps/api/app/Services/Diagnostics/JsAnalyzerAdapter.php:33`–`41`, `:74` | one `source()='js'`, one merged `runStatus()` for ESLint+tsc |
| Tokenizer walk cost | `apps/api/app/Services/Diagnostics/PhpTestFrameworkAdapter.php` (441) | can dominate scan on large repos |
| Unused pdepend | `apps/api/composer.json:25`; no refs under `apps/api/app` | transitive/unused |
| Monolithic Diagnose | `apps/web/src/pages/DiagnosePage.tsx` (417) | inline `renderRow` `:122`–`179`, popover `:319`–`404`, file effect `:81`–`117` |

## Tasks in this epic

| Id (proposed) | Scope | Depends on |
| --- | --- | --- |
| `HD-10` | Surface weighted score + `meta.formula` in HealthPage; fixed color bands; reconcile chain counts | `DX-41` (reconciled chain count) |
| `DX-40` | Server-side group/dedup findings into issues (additive `meta`/new endpoint); rank by impact; default-hide lowest tier; wire web to `depth` + cursor pagination | `DX-41`, `/errors` endpoint |
| `DX-41` | Stop rebuilding `ImpactResolver` per request; replace O(N²) chains with file-indexed connectivity; one source of truth for chains | — |
| `DX-42` | Extract shared `normalizeToolJson()` for PhpStan/Phpcs/Phpmd; JS partial-failure in `analyser_status`; remove/document unused `pdepend` | — |
| `DX-43` | Split `DiagnosePage.tsx` into `FindingsList`/`FindingDetail`/`ImpactPopover`; four UI states; strict types | — |
| `DX-44` | Bound scan cost: gate `PhpTestFrameworkAdapter` tokenizer depth, document per-analyzer timeouts/sharding, cap `HealthSnapshotBuilder` memory | — |

### Dependency graph

```
DX-42  (adapter refactor)   ─── independent ───┐
DX-43  (Diagnose decompose) ─── independent ───┤
DX-44  (scan cost guards)   ─── independent ───┤
                                               ├──▶ ship in any order
DX-41  (cheap + accurate chains) ──┬──▶ DX-40 (grouping/triage: impact ranking)
                                   └──▶ HD-10 (reconciled chain count)
```

Sequencing: land `DX-41` first (it unblocks both a cheap impact source for
`DX-40`'s ranking and the single chain count `HD-10` reconciles). `DX-42`,
`DX-43`, `DX-44` are independent refactors/guards and can run in parallel with
each other and with `DX-41`.

## Governance

Read `/workspace/CLAUDE.md` first. Contracts **C1–C7 are frozen** — implement,
don't redesign; changing a frozen contract surface requires a human-approved
decision-log row in the Obsidian vault (`scholtzdaniel10/LSS-vault`) Roadmap.

Frozen surfaces this epic touches, and how it stays additive:

- **C5 diagnostic-error body** (`packages/schemas/diagnostic-error.schema.json`,
  `additionalProperties: false`): grouping/dedup output goes in `meta` (like the
  existing `meta.chains`) or a **new** additive endpoint — never by mutating the
  per-row shape. See `DX-40`.
- **C2 health snapshot** (`packages/schemas/health-snapshot.schema.json`): the
  score/metrics document is frozen. Exposing `meta.formula` on `bootstrap` is a
  `meta` addition, not a body change; reconciling `metrics.errorChains` is a
  numeric-definition question flagged in `HD-10`.
- **C7 envelope** `{ data, meta, errors }` under `/api/v1` (`apps/api/app/Support/Api/ApiResponse.php`):
  all new fields live inside this envelope; no new top-level keys.

**Provisional ids.** Every id in this set (`HD-10`, `DX-40`–`DX-44`) is
**proposed — confirm/claim in the vault Roadmap before coding**. They sit above
the highest existing ids seen in-repo (DX-5/DX-8/DX-25/DX-34, HD-4, TST-2). The
vault is authoritative; if these numbers collide, renumber per the vault.

## How the every-4-hours automation should consume this

1. Pick **one unblocked task** per run (respect the dependency graph above).
2. **Claim** the task id in the vault Roadmap (🔒 convention) before writing code;
   if a frozen contract surface must change, add the decision-log row and stop
   until it is human-approved.
3. Implement on a fresh `cursor/<slug>-<suffix>` branch; **id-prefixed commits**
   (e.g. `DX-41: cache impact resolver keyed by snapshot id`).
4. Open a **draft PR**; keep C2/C5/C7 changes additive.
5. Tick the vault task and add the daily-note entry on merge.

## Definition of Done (vault note "09 Engineering Standards")

Per acceptance criterion: a **passing test** + the **pre-merge checklist** passes
+ the **vault task ticked** + a **daily-note entry**. Quality bar: design tokens
only, all four UI states (idle/loading/ready/empty/error via
`apps/web/src/components/ScreenState.tsx`), strict TypeScript, no dead code, no
unparameterised SQL (the CI `sql-safety` gate at `.github/workflows/ci.yml:51`
rejects string-built SQL), path-jail all filesystem access, imported code is inert
data (parse, never execute).
