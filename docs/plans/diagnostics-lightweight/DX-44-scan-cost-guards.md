# DX-44 — Scan cost guards for large repos

**Proposed id:** `DX-44` — *provisional; confirm/claim in the vault Roadmap
before coding.*

**Status:** Proposed

**Depends on:** — (independent; parallelizable with `DX-41`/`DX-42`/`DX-43`).

## Problem

Scan cost can balloon on large imported programs, and two spots load unbounded
work with no configurable ceiling:

- **Tokenizer walk.** `PhpTestFrameworkAdapter` runs PHP's `token_get_all` over
  source files (`apps/api/app/Services/Diagnostics/PhpTestFrameworkAdapter.php:193`)
  across configured source roots (`:17` `SOURCE_ROOTS`) with **no size/depth cap** —
  on a large repo this tokenizer pass can dominate scan time. It has a config
  toggle to run at all (`config/diagnostics.php:20`–`21`, `php_test`) but no
  bound on *how much* it walks.
- **Unbounded health arrays.** `HealthSnapshotBuilder::build` loads **all** errors
  and the **full** edge array into memory per build
  (`apps/api/app/Services/HealthSnapshotBuilder.php:24`–`28`), then builds hotspots
  by iterating the whole edge list (`:107`–`144`). On a big graph this is a memory
  spike with no ceiling.

For contrast, PHPStan already has speed knobs — sharding, incremental, parallel,
cache dir, findings buffer (`apps/api/config/speed.php:16`–`46`), consumed in
`AnalysisRunner::run` (`AnalysisRunner.php:97`–`139`) — and ESLint/tsc already run
under a 300s per-process timeout
(`apps/api/app/Services/Diagnostics/JsAnalyzerAdapter.php:90`, `:… tsc process`).
`PhpTestFrameworkAdapter` and `HealthSnapshotBuilder` lack equivalent guards.

Research basis (PHPStan/Sourcegraph/Sentry): never run unbounded work on the hot
path; cheap-path/expensive-path split with explicit limits.

## Goal / success criteria

- `PhpTestFrameworkAdapter`'s tokenizer work is bounded by a **config flag**
  (mirroring the existing `config/speed.php` / `config/diagnostics.php` toggle
  style), skipping/limiting files above a size or count ceiling.
- Per-analyzer timeouts and PHPStan sharding are **documented** in one place so the
  cost model is legible.
- `HealthSnapshotBuilder` no longer loads unbounded arrays — errors/edges are
  streamed/aggregated with a ceiling, without changing the C2 output for
  in-range projects.
- Parse-not-execute and path-jail invariants preserved.

## Approach

1. **Bound the tokenizer.** Add config (e.g. `config/diagnostics.php`:
   `php_test_max_file_bytes`, `php_test_max_files`, env-backed like the existing
   `DIAGNOSTICS_*` flags at `config/diagnostics.php:16`–`27`). In
   `PhpTestFrameworkAdapter::run`, skip files larger than the byte ceiling before
   `token_get_all` (`PhpTestFrameworkAdapter.php:193`) and cap the number of files
   walked; record a `runStatus()` like `partial` (or a note) when the cap trips so
   the operator knows coverage was limited. Default limits generous enough not to
   change small/medium scans.
2. **Document the cost model.** Add a short "Scan cost" section to the epic README
   (or a `docs/` note) enumerating: PHPStan sharding/incremental/parallel/cache
   (`config/speed.php:16`–`46`), ESLint/tsc 300s timeouts (`JsAnalyzerAdapter.php`),
   and the new `php_test` ceilings. This is documentation of **existing +
   new** guards, not new machinery.
3. **Cap health memory.** In `HealthSnapshotBuilder`:
   - Fetch only the columns needed (already narrowed to
     `['severity','file','upstream','downstream']` at `:25`) but iterate via a DB
     cursor / chunk rather than `->get()` when computing `errorCounts`/`errorChains`
     (`:30`–`37`) so all rows aren't held at once.
   - For hotspots, build the in-degree map by streaming edges rather than holding
     the full array where feasible (`:107`–`144`); keep the `max_hotspots`
     truncation (`config/health.php:34`–`38`).
   - Output the identical C2 document for projects within limits.

## Acceptance criteria

- [ ] A new config flag bounds `PhpTestFrameworkAdapter` tokenizer work; files over
      the ceiling are skipped and the run reports it (asserted with an oversized
      fixture).
- [ ] Default limits leave existing small/medium scan output unchanged (asserted by
      existing adapter tests still passing).
- [ ] Per-analyzer timeouts + PHPStan sharding/incremental are documented in one
      place.
- [ ] `HealthSnapshotBuilder` computes counts/hotspots without materializing all
      errors/edges at once (streamed/chunked), producing an identical C2 snapshot
      for in-range fixtures (asserted in `HealthTest`).
- [ ] No imported code executed; path-jail intact.

## Files to touch

**Modify (API):**
- `apps/api/config/diagnostics.php` — `php_test` ceilings (env-backed).
- `apps/api/app/Services/Diagnostics/PhpTestFrameworkAdapter.php` — enforce
  size/count caps; report partial status.
- `apps/api/app/Services/HealthSnapshotBuilder.php` — cursor/chunk instead of
  `->get()`; streamed in-degree.

**Modify (docs):**
- `docs/plans/diagnostics-lightweight/README.md` (or a new `scan-cost.md`) — the
  documented cost model.

## Tests to add (mirror existing test files)

- Extend `apps/api/tests/Feature/PhpAnalyzerAdapterTest.php` (or add a dedicated
  `PhpTestFrameworkAdapterTest.php`) — an oversized fixture file is skipped and the
  cap is reported; under-limit fixtures unchanged.
- Extend `apps/api/tests/Feature/HealthTest.php` — the streamed builder yields the
  same C2 snapshot as before on a fixture, and does not `->get()` all errors
  (assert via a spy/count or a large-fixture memory-safe path).

## Contract & security notes

- **C2 (frozen):** the health snapshot **document must stay identical** for
  in-range projects — this is a memory/perf change, not a schema change
  (`packages/schemas/health-snapshot.schema.json`). If a ceiling ever changes the
  *emitted metrics* (e.g. a truncated hotspot count that differs from the
  unbounded result), that is a **C2 semantic change → decision-log row in the
  vault before shipping.** Design the defaults so no in-range project's output
  changes; document any truncation behavior for out-of-range giants and get vault
  sign-off if it alters the C2 numbers.
- **C5/C7:** unchanged; a `partial` analyser status rides in the existing
  `meta.analysers` map (`ErrorController.php:76`–`77`) — additive.
- **Parse-not-execute:** the tokenizer path stays parse-only (`token_get_all`,
  `PhpTestFrameworkAdapter.php:193`); caps only reduce what is parsed — no
  execution of imported code (`config/diagnostics.php:9`–`13`).
- **Path-jail:** file selection/size checks must stay within the sandbox root.
- **SQL safety:** cursor/chunk uses the query builder; no string-built SQL (CI gate
  `.github/workflows/ci.yml:51`).

## Risks / out of scope

- **Risk:** overly tight defaults silently reduce coverage. Mitigation: generous
  defaults + explicit `partial` status + documented behavior; only tighten with
  evidence.
- **Out of scope:** PHPStan tuning (already has knobs), new sharding for JS/PHPCS,
  and the `tests` sub-score (TST track).

## Governance

Claim `DX-44` in the vault Roadmap before coding. Keep C2 output identical for
in-range projects → no frozen-contract change; if any ceiling changes emitted C2
metrics, add a decision-log row and wait for human approval. Id-prefixed commits;
draft PR; note-09 DoD.
