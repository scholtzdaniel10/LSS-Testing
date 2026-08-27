# HD-10 — Health score transparency (surface the formula + fixed color bands)

**Proposed id:** `HD-10` — *provisional; confirm/claim in the vault Roadmap
before coding.*

**Status:** Proposed

**Depends on:** `DX-41` (single reconciled chain count). Can start the UI/formula
work independently, but the chain-count reconciliation must land on `DX-41`'s
source of truth.

## Problem

The health score is a weighted average whose recipe already exists as
`config('health.formula')` (`apps/api/config/health.php:42`–`46`) with weights
0.35 errors / 0.25 dependencies / 0.20 tests / 0.20 structure
(`config/health.php:11`–`16`), but the dashboard never shows it:

- `HealthReportController::show` returns `meta.formula`
  (`apps/api/app/Http/Controllers/Api/V1/HealthReportController.php:32`), yet the
  dashboard cold-loads from **bootstrap**, which returns the health snapshot with
  **no** formula (`apps/api/app/Http/Controllers/Api/V1/BootstrapController.php:35`–`41`;
  consumed at `apps/web/src/state/ProjectContext.tsx:109`–`118`).
- `HealthPage.tsx` renders `ScoreRing` + `TrendChart` + dimension `StatTile`s but
  never fetches or displays the formula, and applies no fixed color bands
  (`apps/web/src/pages/HealthPage.tsx`, whole file; dimensions built at `:18`–`55`).
- The "chains" number shown on Health (`metrics.errorChains`, an impact heuristic:
  errors with empty upstream + non-empty downstream —
  `apps/api/app/Services/HealthSnapshotBuilder.php:35`–`37`, surfaced at
  `HealthPage.tsx:27`) **disagrees** with the `ChainDetector.chain_id` groups shown
  in Diagnose (`ErrorController.php:90`–`109`). Same word, two numbers.

Research basis (Lighthouse/SonarQube): make the score a transparent weighted
average of a few named sub-scores, with fixed color bands (0–49 red / 50–89 amber
/ 90–100 green) and a glanceable grade paired with precise values.

## Goal / success criteria

- `HealthPage` shows the overall score and each sub-score with **fixed color
  bands** (0–49 red / 50–89 amber / 90–100 green) using design tokens.
- A "How is this calculated?" panel shows the human-readable formula (weights +
  penalties) sourced from API `meta.formula` — never hardcoded in the web app.
- Health and Diagnose report the **same** chain count (one definition).
- All four UI states preserved.

## Approach

1. **Expose `meta.formula` on bootstrap.** Add `['formula' => config('health.formula')]`
   to the `meta` of `BootstrapController::show`'s `respond()` call
   (`BootstrapController.php:41`). This is a **`meta` addition inside the C7
   envelope**, not a change to the C2 snapshot body — see contract notes. The
   read-cache payload (`bootstrap:{id}`) stays the C2 doc; the formula is emitted
   at response time from config, so no cache invalidation is needed.
   - Alternative (no bootstrap change): have the web fetch `GET
     /projects/{id}/health-report` for the formula only. Prefer the bootstrap
     `meta` addition to avoid a second round-trip on cold start; keep the
     health-report call as fallback.
2. **Web: read the formula.** Extend the bootstrap client type with an optional
   `meta.formula: string`, thread it through `ProjectContext` (alongside
   `health`), and render it in a collapsible "How is this calculated?" panel on
   `HealthPage`. Parse only for display; do not recompute the score client-side.
3. **Fixed color bands.** Add a `scoreBand(score): 'good' | 'warn' | 'bad'` helper
   (web `lib`) mapping 90–100/50–89/0–49 to existing status design tokens
   (`--status-good` etc., already used in `DiagnosePage.tsx:209`). Apply to the
   `ScoreRing` overall and every `StatTile` in `buildDimensions`
   (`HealthPage.tsx:18`–`55`). Redundant encoding: color **plus** the numeric value
   **plus** a text grade (icon optional) — never color alone.
4. **Reconcile the chain count.** Make `metrics.errorChains` mean the same thing as
   the `ChainDetector.chain_id` group count. `DX-41` establishes the single source
   of truth (persisted `chain_id` groups). `HealthSnapshotBuilder::build` should
   count **distinct non-null `chain_id`s** on the latest scan instead of the
   empty-upstream/non-empty-downstream heuristic (`HealthSnapshotBuilder.php:35`–`37`).
   Whether the C2 field keeps the name `errorChains` or gains a sibling is a
   **contract decision** — see notes.

## Acceptance criteria

- [ ] Bootstrap response includes `meta.formula` equal to `config('health.formula')`.
- [ ] `HealthPage` renders a "How is this calculated?" panel showing the formula
      text from API meta (asserted in a component test).
- [ ] Overall score and each sub-score show a fixed color band (red/amber/green)
      via design tokens, with the numeric value always visible.
- [ ] `metrics.errorChains` (or its agreed replacement) equals the Diagnose
      `meta.chains` group count for the same scan (asserted in a feature test).
- [ ] Idle/loading/ready/empty/error states unchanged and covered.

## Files to touch

**Modify (API):**
- `apps/api/app/Http/Controllers/Api/V1/BootstrapController.php` — add
  `meta.formula`.
- `apps/api/app/Services/HealthSnapshotBuilder.php` — chain-count reconciliation
  (consume `DX-41`'s source of truth).

**Modify (web):**
- `apps/web/src/api/client.ts` — bootstrap type gains optional `meta.formula`.
- `apps/web/src/state/ProjectContext.tsx` — thread the formula through.
- `apps/web/src/pages/HealthPage.tsx` — "How is this calculated?" panel + bands.

**Create (web):**
- `apps/web/src/lib/scoreBand.ts` (+ optional `HealthFormulaPanel.tsx` component).

## Tests to add (mirror existing test files)

- API: extend `apps/api/tests/Feature/HealthTest.php` — assert bootstrap `meta.formula`
  present and equal to config; assert reconciled `errorChains` equals the
  `ChainDetector` group count for a fixture scan.
- Web: extend `apps/web/src/pages/DiagnosePage.test.tsx` conventions with a new
  `apps/web/src/pages/HealthPage.test.tsx` — formula panel renders from meta;
  `scoreBand` maps boundary values (49→bad, 50→warn, 89→warn, 90→good).

## Contract & security notes

- **C7:** `meta.formula` lives inside the `{ data, meta, errors }` envelope
  (`apps/api/app/Support/Api/ApiResponse.php`) — additive `meta`, compliant.
- **C2:** adding formula to `meta` does **not** touch the health-snapshot body
  schema (`packages/schemas/health-snapshot.schema.json`) → no C2 change.
  **However**, redefining `metrics.errorChains` changes the *meaning* of a C2
  metric. If the field name/semantics in the C2 schema shift, that is a **frozen
  C2 surface change → requires a human-approved decision-log row in the vault
  Roadmap.** Preferred non-breaking path: keep `errorChains` counting distinct
  `chain_id`s (a definition tightened to match Diagnose, no schema edit) and flag
  the semantic change for vault sign-off; only add a new C2 field if the vault
  approves.
- No SQL built from interpolation; counting distinct `chain_id` uses the query
  builder / bindings. No filesystem access added.

## Risks / out of scope

- **Risk:** changing `errorChains` semantics silently shifts historical trend
  charts. Mitigation: bands/formula UI can ship first; gate the count change on the
  vault decision and note it in the daily log.
- **Out of scope:** the `tests` sub-score is hardcoded 0 until TST work
  (`HealthSnapshotBuilder.php:44`–`46`, `:179`) — display it honestly, do not
  invent coverage.

## Governance

Claim `HD-10` in the vault Roadmap before coding. If the C2 `errorChains`
definition is judged a frozen-surface change, add the decision-log row and wait
for human approval before merging that part. Id-prefixed commits; draft PR;
note-09 DoD.
