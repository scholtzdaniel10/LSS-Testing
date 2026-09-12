# IG-35 — Scale performance harness (fixture + CI budgets)

**Proposed task id:** IG-35 *(provisional — confirm/claim in the vault Roadmap
before coding; prefix commits with the claimed id)* — TST-track work.

**Status:** Proposed

**Depends on:** IG-30 (extraction bounds), IG-31 (aggregation bounds), IG-33
(client model-build budget). The skeleton can be authored early and tightened as
each task lands.

## Problem

There is no large-scale fixture and no scaling regression gate, so nothing stops
a future change from re-introducing whole-project extraction/transfer/compute.

- Existing fixtures are tiny: `apps/api/tests/fixtures/` holds `impact-chain`,
  `ci3-mini`, `mixed-lang`, `php-test`, `legacy-php-custom`, `phpstan-defects` —
  all a handful of files. None exercises the 4k/25k caps
  (`DependencyGraphBuilder.php:18`, `LocalDirectoryScanner.php:18`) or dense edge
  sets.
- Existing tests validate *correctness*, not *bounds*:
  `apps/api/tests/Unit/DependencyGraphBuilderTest.php`,
  `apps/web/src/lib/graphModel.test.ts`, `apps/web/src/lib/radialModel.test.ts`.
- CI (`.github/workflows/ci.yml`) runs Pint + Pest (api), eslint +
  `npm run test.unit` + `npm run build` (web), and the `sql-safety` gate — but no
  performance/scale assertions.

## Goal / success criteria

- A **large synthetic fixture** (~20k files / ~60k edges) available to both the
  API and web test suites, generated deterministically (committed generator, and
  either a committed fixture or a generated-on-demand one).
- **Backend budgets**: extraction + aggregation complete within asserted
  time/coverage bounds on the fixture (validates IG-30/IG-31).
- **Web budgets**: model-build time budget, worker correctness/parity, and tree
  virtualization asserted (validates IG-33).
- Wired into CI so scaling regressions fail the build.

## Approach

Prefer a deterministic **generator** over committing 20k files (keeps the repo
lean and the sql-safety/grep gates fast); commit a small manifest/seed so runs
are reproducible.

1. **Synthetic fixture generator.**
   - **API side:** `apps/api/tests/Support/SyntheticProject.php` (or an artisan
     dev command) that writes a temp tree of ~20k source files with realistic
     import/require statements producing ~60k edges, using a fixed seed for
     determinism. Mirror the temp-dir approach already used in
     `DependencyGraphBuilderTest.php:8-18` (create → test → clean up), just at
     scale. Reuse the real parsers (`PhpFileParser`, `JsFileParser`,
     `HtmlFileParser`) so edges are genuine.
   - **Web side:** `apps/web/src/lib/__fixtures__/syntheticGraph.ts` exporting a
     deterministic generator `makeSyntheticGraph(files, edges)` returning
     `GraphEdge[]` + path list, so vitest can build large inputs without a
     committed blob. Align path shapes with `folderOf`/`folderKeyOf` buckets so
     folder rollups are exercised.
   - Keep any committed fixture small; large trees are generated at test time and
     cleaned up.

2. **Backend benchmarks / bound assertions (Pest).**
   - Extraction: on the synthetic tree, assert coverage scales past the old 4000
     cap (IG-30), determinism (identical ordered edges across two runs), and that
     the time/memory budget guard trips with `truncated: true` when configured
     low — without throwing. Assert wall-clock stays under a generous CI ceiling
     (loose enough to avoid flakiness, tight enough to catch O(n²) regressions).
   - Aggregation: on ~60k edges, assert `GraphAggregator` (IG-31) produces
     overview ≤ cap, neighbourhood bounded by `hops`/`limit`, and rollup weights
     correct, within a time bound.
   - Mark heavy tests with a Pest group (e.g. `->group('scale')`) so they can run
     in a dedicated CI step and be excluded from the fast local loop.

3. **Web performance / unit tests (vitest).**
   - Model-build time budget: building `buildGraphView` / `buildRadialLayout` over
     the synthetic input completes under a budget (measured; generous ceiling).
   - Worker correctness/parity (IG-33): worker output equals direct function
     output on the synthetic input.
   - Virtualization (IG-33): for the synthetic path list, only a bounded number of
     `treeitem` rows mount.

4. **CI wiring.** Extend `.github/workflows/ci.yml`:
   - Add a `scale` Pest step (or a job) running the `scale`-group tests
     (`./vendor/bin/pest --group=scale --ci`) after the existing Pest step.
   - The web `test.unit` step already runs vitest; add the scale specs there (or a
     separate `npm run test.scale` script in `apps/web/package.json` invoked by a
     new CI step). Keep budgets env-tunable to reduce flakiness on shared runners.
   - Do **not** loosen or bypass the `sql-safety` gate.

5. **Determinism + flakiness guardrails.** Fixed seeds; assert *shape/coverage*
   bounds strictly and *time* bounds loosely (ratio-based or generous absolute
   ceilings); allow a documented env override for the time ceilings so the gate
   catches algorithmic regressions without failing on a slow runner.

## Acceptance criteria (testable)

- [ ] A deterministic generator produces ~20k files / ~60k edges (API temp tree +
      web in-memory), reproducible across runs.
- [ ] Backend: extraction coverage scales past 4000, is deterministic, and the
      budget guard trips cleanly; aggregation stays within bounds — all asserted
      on the synthetic fixture.
- [ ] Web: model-build budget, worker parity, and tree virtualization asserted on
      the synthetic input.
- [ ] New CI step(s) run the scale suites and fail on regression; existing CI
      steps (Pint, Pest, eslint, build, sql-safety) still pass.
- [ ] Scale tests are grouped/scriptable so the fast local loop is unaffected.

## Files to touch

- **Create** `apps/api/tests/Support/SyntheticProject.php` — seeded generator.
- **Create** `apps/api/tests/Feature/GraphScaleTest.php` (group `scale`) —
  extraction + aggregation bounds.
- **Create** `apps/web/src/lib/__fixtures__/syntheticGraph.ts` — seeded generator.
- **Create** `apps/web/src/lib/scale.perf.test.ts` — model-build budget, worker
  parity, virtualization.
- **Modify** `.github/workflows/ci.yml` — scale Pest step + web scale step.
- **Modify** `apps/web/package.json` — optional `test.scale` script.

## Tests to add

This task *is* the tests — mirroring existing conventions:
- Pest style from `apps/api/tests/Unit/DependencyGraphBuilderTest.php`
  (temp-dir fixtures, `expect(...)` chains).
- vitest style from `apps/web/src/lib/graphModel.test.ts` /
  `radialModel.test.ts` (`describe`/`it`, small deterministic edge helpers like
  `edge(from, to)`).

## Contract & security notes

- **Contract**: none — test-only. No C1–C7 impact.
- **CLAUDE.md invariants**: the generator writes **inert data files** into a
  path-jailed temp dir and cleans up (never executes them); no network; no target
  credentials; no raw SQL. Synthetic content must not include anything the
  `sql-safety` grep gate would flag in `apps/api/app` or `apps/api/routes` — keep
  generated files under `tests/` only.

## Risks / out of scope

- **Risk:** time-based assertions are flaky on shared CI runners. Mitigation:
  strict correctness/coverage bounds + loose, env-tunable time ceilings; prefer
  algorithmic-regression signals (e.g. relative growth) over absolute ms.
- **Risk:** generating 20k files each run is slow. Mitigation: scope to a
  dedicated CI step/group; consider caching a generated tree within a run;
  down-scale locally via env.
- **Out of scope:** the features under test (IG-30/31/32/33/34) — this task only
  measures and gates them.

## Governance

- Claim the real id (TST-family or IG per vault convention) in the vault Roadmap
  before coding; commit with that prefix; no `Co-Authored-By: Claude` trailer.
- No frozen-contract change (test-only).
- Definition of done per epic README (note 09): the scale suites pass in CI and
  demonstrably fail when a scaling regression is introduced; strict types; no
  dead code.
