# IG-30 — Graph extraction coverage for large codebases

**Proposed task id:** IG-30 *(provisional — confirm/claim in the vault Roadmap
before coding; prefix commits with the claimed id)*

**Status:** Proposed

**Depends on:** — (foundational; unblocks IG-31 and IG-35)

## Problem

Extraction parses far fewer files than the scanner indexes, so on a large
program the dependency graph is silently incomplete and non-deterministic.

- `apps/api/app/Services/Graph/DependencyGraphBuilder.php:18` —
  `private const MAX_FILES = 4000;`. Enforced in `build()`
  (`DependencyGraphBuilder.php:105`) and `buildIndexed()`
  (`DependencyGraphBuilder.php:139`, `if (++$count > self::MAX_FILES) break;`).
- `apps/api/app/Services/Import/LocalDirectoryScanner.php:18` —
  `private const MAX_FILES = 25_000;`. The index holds up to ~6× more files than
  extraction parses → on a 25k-file program up to ~84% of indexed files never
  contribute edges.
- `apps/api/app/Jobs/AnalyzeProject.php:53-62` — the candidate paths come from
  `project->files()->whereIn('lang', $graph->parseableLangs())->pluck('path')`.
  The 4000 cap then applies in whatever order that query returns rows, so which
  files "win" the cap is effectively arbitrary and can change between runs.
- Files over `512_000` bytes are skipped (`DependencyGraphBuilder.php:149`) — a
  legitimate safety guard we keep.
- There is currently **no signal** to the client or health snapshot that the
  graph was truncated; `GraphController::show`
  (`apps/api/app/Http/Controllers/Api/V1/GraphController.php:15-39`) returns
  `{ projectId, scannedAt, edges }` with no coverage metadata.

## Goal / success criteria

- Graph extraction coverage scales toward the 25k index cap instead of stopping
  at 4000, **without** letting `AnalyzeProject` blow its worker budget
  (`AnalyzeProject::$timeout = 660`, `@set_time_limit(600)` at
  `AnalyzeProject.php:41`).
- Coverage is **deterministic**: given the same file set, the same files are
  parsed in the same order across runs.
- Analysis stays bounded: a time/memory budget guard stops extraction cleanly
  and records how much was covered, rather than timing out the whole job.
- A `coverage` / `truncated` signal is produced by extraction and surfaced (as an
  **additive** field) so the UI can honestly say "graph covers N of M files".
- Security invariants preserved: parse-not-execute, path-jail, file-size guard.

## Approach

Concrete, referencing real symbols:

1. **Raise the coverage ceiling, keep a guard.** Replace the hard
   `MAX_FILES = 4000` in `DependencyGraphBuilder.php:18` with a configurable
   ceiling aligned to the scanner (default up to `LocalDirectoryScanner`'s
   `25_000`), read from a new `config('graph.max_parse_files', 25000)` key
   (add `apps/api/config/graph.php`, mirroring the existing
   `config('speed.*')` / `config('sandbox.*')` pattern). Keep the
   `strlen($source) > 512_000` file-size guard (`DependencyGraphBuilder.php:149`)
   unchanged.

2. **Add a bounded extraction budget.** Introduce a wall-clock + parsed-count
   budget inside `buildIndexed()` so extraction cannot run unbounded on a huge
   tree: e.g. `config('graph.max_parse_seconds', 120)` and the file ceiling.
   When either bound is hit, stop cleanly and mark the result truncated. The
   budget lives below `AnalyzeProject`'s 600s guard so PHPStan still has
   headroom.

3. **Deterministic parse ordering.** Sort candidate paths before parsing so the
   covered set is stable and reviewable. Do this at the source in
   `AnalyzeProject.php:53-56` (add `->orderBy('path')` to the `files()` query —
   Postgres can use the existing `project_files (project_id, path
   text_pattern_ops)` index from
   `2026_07_20_000001_optimize_for_postgres.php:84-86`) and defensively
   `sort()` inside `buildIndexed()` so the ordering holds for the legacy
   `build()` zip path too (which already collects `$paths` then delegates —
   `DependencyGraphBuilder.php:104-110`). Note `LocalDirectoryScanner::scan`
   already `usort`s by path (`LocalDirectoryScanner.php:74`); make the builder's
   ordering explicit rather than relying on caller order.

4. **Return a coverage report from extraction.** Change `buildIndexed()` to also
   report `{ parsed, skipped, eligible, truncated }` alongside edges — either via
   a small result object/DTO or a companion method
   `lastCoverage(): array{parsed:int, eligible:int, truncated:bool}` to avoid
   breaking the current `list<edge>` return relied on by tests
   (`DependencyGraphBuilderTest.php`) and by
   `IncrementalGraphBuilder::buildIndexed` (`IncrementalGraphBuilder.php:20-78`,
   which delegates per-file). Prefer the companion-method form to keep the edge
   return shape and the incremental per-file cache intact.

5. **Persist coverage on the snapshot.** In `AnalyzeProject::handle`
   (`AnalyzeProject.php:58-62`) capture the coverage report and persist it
   next to the snapshot. Two options — pick one and note the governance
   consequence:
   - **Preferred (no contract change):** store coverage in a new nullable column
     on `graph_snapshots` (additive migration) and expose it via the `/graph`
     response **`meta`** block, not `data`. `meta` is free-form under C7, so this
     does not alter the C3 `data`/edge shape.
   - Alternative: fold coverage into the health snapshot only. Weaker — the
     Explore views can't show it.

6. **Surface coverage additively on `/graph`.** In `GraphController::show`
   (`GraphController.php:26-38`) add `truncated` / `coverage` to the **meta**
   argument of `respond($payload, $meta)` (the base controller already supports
   meta — `Controller.php:15-18`). Do **not** add fields inside the edge objects
   or the `data` block. Warm-cache parity: mirror the meta into the cached
   payload built in `AnalyzeProject::warmReadCaches`
   (`AnalyzeProject.php:230-237`).

## Acceptance criteria (testable)

- [ ] A fixture project with more files than the old 4000 cap yields edges from
      files beyond index 4000 (coverage scales past the old cap).
- [ ] Parsing the same file set twice produces byte-identical ordered edge lists
      (determinism).
- [ ] When the file/time budget is exceeded, extraction stops cleanly and reports
      `truncated: true` with a `parsed`/`eligible` count; the job still completes
      (does not throw/timeout).
- [ ] Files > 512_000 bytes are still skipped (guard preserved).
- [ ] `GET /graph` returns coverage/truncated in **`meta`**; `data`/edge shape is
      byte-identical to today for a non-truncated project.
- [ ] Pint + Pest green; `sql-safety` gate green (no string-built SQL).

## Files to touch

- **Modify** `apps/api/app/Services/Graph/DependencyGraphBuilder.php` — config
  ceiling, budget guard, deterministic sort, coverage report.
- **Create** `apps/api/config/graph.php` — `max_parse_files`,
  `max_parse_seconds` (mirrors `config/speed.php`, `config/sandbox.php`).
- **Modify** `apps/api/app/Jobs/AnalyzeProject.php` — `orderBy('path')` on the
  candidate query, capture coverage, persist + warm cache.
- **Modify** `apps/api/app/Http/Controllers/Api/V1/GraphController.php` — add
  coverage to `respond()` meta.
- **Create** `apps/api/database/migrations/XXXX_add_coverage_to_graph_snapshots.php`
  — additive nullable coverage column (guard any Postgres-specific type; keep
  SQLite green as in `2026_07_20_000001_optimize_for_postgres.php`).
- **(If chosen)** `apps/api/app/Models/GraphSnapshot.php` — cast the new column.

## Tests to add

- **Extend** `apps/api/tests/Unit/DependencyGraphBuilderTest.php` (mirror its
  temp-dir fixture style): coverage-past-old-cap, deterministic ordering,
  budget-truncation reports `truncated`, file-size guard retained.
- **Add** a feature/Pest test for `GraphController` asserting `meta.truncated` /
  `meta.coverage` appear and `data` is unchanged when not truncated (mirror
  existing controller tests under `apps/api/tests/`).
- IG-35 will add the large synthetic fixture; until then use a generated
  temp-dir tree in the unit test (as existing tests already do).

## Contract & security notes

- **C3 (`packages/schemas/dependency-edge.schema.json`)**: the edge object shape
  is **unchanged**. Coverage is exposed only via `meta`, which is behavioural
  (C7) not a payload contract — no schema change required. If a future reviewer
  wants coverage inside `/graph` `data`, that **is** a C3/response change → vault
  decision-log row + schema bump first.
- **CLAUDE.md invariants**: parse-not-execute preserved (extraction only reads +
  parses source); path-jail preserved (paths still resolved under the sandbox
  root, `DependencyGraphBuilder.php:143-146`); file-size guard preserved
  (`:149`); no SQL string-building (ordering uses the query builder
  `orderBy('path')`).

## Risks / out of scope

- **Risk:** raising the ceiling increases analysis time on huge trees. Mitigated
  by the time/memory budget and by the per-file content-addressed cache in
  `IncrementalGraphBuilder` (`IncrementalGraphBuilder.php:49-68`) — re-scans only
  reparse changed files.
- **Risk:** larger edge blobs make `/graph` heavier — but that is exactly what
  IG-31 (aggregation) and IG-34 (progressive load) address; IG-30 deliberately
  produces *more* edges for those tasks to summarise.
- **Out of scope:** server-side aggregation (IG-31), changing the transfer shape
  of the edge list (IG-31/IG-34), the synthetic benchmark fixture (IG-35).

## Governance

- Claim the real IG id in the vault Roadmap before coding; commit with that
  prefix; no `Co-Authored-By: Claude` trailer.
- No frozen-contract change if coverage stays in `meta` (recommended). If the
  team decides to put coverage in `/graph` `data` or inside the edge object, add
  a decision-log row in the vault Roadmap + bump C3 in vault note 00 first.
- Definition of done per the epic README (note 09): passing tests, four UI states
  where UI is touched (this task is mostly backend — the coverage banner UI is
  optional and, if added, must use design tokens + honour all states), strict
  types, no dead code.
