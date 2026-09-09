# DX-42 — Analyzer adapter simplification (shared normalize, honest JS status, drop pdepend)

**Proposed id:** `DX-42` — *provisional; confirm/claim in the vault Roadmap
before coding.*

**Status:** Proposed

**Depends on:** — (independent refactor; parallelizable with `DX-41`/`DX-43`/`DX-44`).

## Problem

Each PHP adapter re-implements the same pipeline — decode tool JSON → relative
path → range → taxonomy classify → build finding array — in ~70–90 lines:

- `apps/api/app/Services/Diagnostics/PhpStanAdapter.php` (446 lines)
- `apps/api/app/Services/Diagnostics/PhpcsAdapter.php` (203 lines)
- `apps/api/app/Services/Diagnostics/PhpmdAdapter.php` (218 lines)

A bug in path relativization or range mapping must be fixed in three places.

Two more adapter liabilities:

- **JS partial failure is hidden.** `JsAnalyzerAdapter` runs **both** ESLint and
  tsc (`apps/api/app/Services/Diagnostics/JsAnalyzerAdapter.php:48`–`77`) but
  reports a single `source() = 'js'` (`:33`–`36`) and a single merged
  `runStatus()` (`:38`–`41`, set once at `:74`). If ESLint succeeds but tsc fails
  (or vice-versa), `analyser_status` shows one blended state — the operator can't
  tell which tool broke.
- **Unused dependency.** `pdepend/pdepend` is declared
  (`apps/api/composer.json:25`) but has **no references under `apps/api/app`**
  (transitive/unused) — dead weight and a supply-surface with no payoff.

Research basis (PHPStan/Sourcegraph/Sentry architecture): a small registry of
narrowly-scoped rules with a **shared normalize helper** so per-tool adapters stay
thin.

## Goal / success criteria

- One shared `normalizeToolJson()` helper/trait removes ~150 duplicated lines
  across the three PHP adapters; path/range logic lives in one place.
- `JsAnalyzerAdapter` reports ESLint vs tsc status **distinctly** in
  `analyser_status`.
- The unused `pdepend` dependency is removed, or explicitly documented as
  required-transitive if something actually needs it.
- `EvidenceGate` + `Taxonomy` behavior and every finding's output are unchanged.

## Approach

1. **Extract `normalizeToolJson()`.** Add a `NormalizesFindings` trait (or a small
   `FindingNormalizer` collaborator) under `apps/api/app/Services/Diagnostics/`
   that takes the tool-agnostic bits: sandbox-relative path (path-jailed), a
   `range` `{startLine,endLine,...}`, `Taxonomy::classify(source, ruleId, message)`
   (as used at `JsAnalyzerAdapter.php:142`, `:211`), and assembles the finding
   array that `EvidenceGate::accept` expects
   (`apps/api/app/Services/Diagnostics/AnalysisRunner.php:213`–`247`). Refactor
   `PhpStanAdapter`, `PhpcsAdapter`, `PhpmdAdapter` to call it; each keeps only its
   tool-invocation + decode specifics. **No output change** — the finding arrays
   must be identical.
2. **Split JS status by tool.** Keep `run()` merging ESLint+tsc findings, but track
   per-tool outcome. Options that keep C5/registry semantics:
   - Report `analyser_status` with distinct keys: `eslint` and `tsc` (the registry
     already keys on `source()`; introduce two sources for JS, or emit a
     structured `runStatus()` the runner records per tool). The runner records
     `analyserStatus[$source]` (`AnalysisRunner.php:135`–`143`), so distinct
     sources naturally surface distinct statuses (`missing_binary`/`clean`/`ok`).
   - Preferred: make `JsAnalyzerAdapter` expose the two tools as two registry
     entries (or emit `analyser_status.eslint` / `analyser_status.tsc`), so a tsc
     crash shows `tsc: error` while `eslint: ok`. The web already renders whatever
     analyser keys the API returns (`apps/web/src/pages/DiagnosePage.tsx:71`–`75`,
     `:197`–`219`) — no hardcoded names — so distinct keys flow through with no web
     change.
3. **Remove/document pdepend.** Confirm no runtime/config reference (grep under
   `apps/api/app` and `apps/api/config` — currently none). Remove
   `"pdepend/pdepend"` from `apps/api/composer.json:25` and update `composer.lock`.
   If a required package pulls it transitively, leave it and add a one-line comment
   in `composer.json` explaining why it stays.

## Acceptance criteria

- [ ] `PhpStanAdapter`/`PhpcsAdapter`/`PhpmdAdapter` produce byte-identical finding
      arrays before/after, now routed through `normalizeToolJson()` (asserted by
      existing adapter tests).
- [ ] Net reduction of ~150 lines across the three PHP adapters (no dead code left).
- [ ] `analyser_status` distinguishes ESLint from tsc (e.g. `eslint: ok`,
      `tsc: missing_binary`) — asserted in a JS adapter test with one tool failing.
- [ ] `pdepend/pdepend` removed from `composer.json`/`composer.lock`, or a comment
      documents why it must stay; `composer install` still resolves.
- [ ] `EvidenceGate`/`Taxonomy` classification outputs unchanged.

## Files to touch

**Create (API):**
- `apps/api/app/Services/Diagnostics/NormalizesFindings.php` (trait) or
  `FindingNormalizer.php`.

**Modify (API):**
- `apps/api/app/Services/Diagnostics/PhpStanAdapter.php`,
  `PhpcsAdapter.php`, `PhpmdAdapter.php` — use the shared helper.
- `apps/api/app/Services/Diagnostics/JsAnalyzerAdapter.php` — per-tool status.
- `apps/api/composer.json` (+ `composer.lock`) — drop/annotate `pdepend`.
- Possibly `apps/api/app/Services/Diagnostics/AnalysisRunner.php` /
  `AnalyzerRegistry` if JS becomes two registry entries.

## Tests to add (mirror existing test files)

- Extend `apps/api/tests/Feature/PhpAnalyzerAdapterTest.php` — same fixtures, assert
  identical findings post-refactor (the regression guard for the shared helper).
- Extend `apps/api/tests/Feature/JsAnalyzerAdapterTest.php` — simulate ESLint ok +
  tsc missing binary; assert `analyser_status` shows both distinctly.

## Contract & security notes

- **C5/C7:** finding rows and the envelope are unchanged; `analyser_status` already
  lives in `meta.analysers` (`ErrorController.php:76`–`77`) as a free-form map —
  adding `eslint`/`tsc` keys is additive **within existing meta**, not a C5 body
  change. **No frozen-contract change → no decision-log row.**
- **Parse-not-execute:** adapters must keep tokenizing / invoking **Maintain-owned**
  vendor binaries only, never executing imported project code
  (`apps/api/config/diagnostics.php:9`–`13`). The shared helper does string/array
  work only.
- **Path-jail:** the shared relativizer must reject paths escaping the sandbox root
  (preserve current per-adapter behavior).
- **SQL safety:** none of this touches SQL.

## Risks / out of scope

- **Risk:** silent behavior drift in the shared normalizer. Mitigation: refactor
  under green adapter tests; assert identical output on fixtures.
- **Risk:** splitting JS into two registry sources could change `analyser_status`
  keys the web iterates — but the web is registry-driven (`DiagnosePage.tsx:71`),
  so verify the panel still renders and add a component assertion if needed.
- **Out of scope:** rule-set tuning, new analyzers, taxonomy content changes
  (`packages/schemas/taxonomy.json` is DX-5 metadata, not frozen — leave it).

## Governance

Claim `DX-42` in the vault Roadmap before coding. No frozen-contract surface
changes. Id-prefixed commits; draft PR; note-09 DoD (no dead code — the removed
adapter lines and `pdepend` must be genuinely gone, not commented out).
