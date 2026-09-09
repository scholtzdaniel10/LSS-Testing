# DX-40 — Finding grouping, dedup & triage

**Proposed id:** `DX-40` — *provisional; confirm/claim in the vault Roadmap
before coding.*

**Status:** Proposed

**Depends on:** `DX-41` (cheap, single-source impact for ranking) and the existing
`/errors` endpoint (`apps/api/app/Http/Controllers/Api/V1/ErrorController.php`).

## Problem

Findings are presented raw: one row per `DiagnosticError`, with no server-side
grouping/dedup into higher-level issues and no way to hide low-value noise. The
API already supports the controls the UI needs, but the web ignores them:

- The `/errors` list returns per-row C5 findings, keyset-paginated
  (`ErrorController.php:52`–`70`); chain groupings live in `meta.chains`
  (`:81`), and `depth` (1–3) and `severity`/`kind`/`file` filters are supported
  (`apps/api/app/Http/Requests/ListErrorsRequest.php:23`–`32`).
- The web loads only the **first page** at **default depth=1** and renders **all**
  severities with **no pagination UI and no depth control**
  (`apps/web/src/state/ProjectContext.tsx:109`–`121`; `apps/web/src/pages/DiagnosePage.tsx`,
  whole file — grouping is client-side via `groupByChain` at `DiagnosePage.tsx:51`
  using server `meta.chains`).

Research basis (Sentry/GitHub/VS Code): group/dedup raw findings into issues,
rank by impact, hide the lowest tier by default, keep one small ordered severity
scale, give each issue "why / how to fix / one action". Dismissal-with-reason +
audit is a proven pattern but needs storage.

## Goal / success criteria

- The server groups/dedups findings into **issues** with a deterministic
  fingerprint, exposed **additively** (in `meta` or a new endpoint — C5 row body
  unchanged).
- Issues are **ranked by impact** (downstream blast radius from `DX-41`).
- The lowest severity tier (`info`) is **hidden by default**, toggleable.
- The web Diagnose uses the already-supported **`depth`** param and **cursor
  pagination**.

## Approach

1. **Deterministic fingerprint.** Define an issue key as a stable hash of
   `ruleId + normalizedPath + kind` (path normalized exactly like
   `ImpactResolver::normalize`, `apps/api/app/Services/Diagnostics/ImpactResolver.php:95`–`98`).
   Identical rule violations on the same file collapse into one issue with a
   `count` and representative range. Deterministic → same input yields same key
   across scans (enables future dismissal keys).
2. **Where the grouping lives (additive).** Two options, both keep the C5 row shape:
   - **Preferred:** add `meta.issues` to the existing `/errors` response
     (`ErrorController.php` `ApiResponse::cursorPaginated(..., [...])` at `:75`–`82`),
     mirroring how `meta.chains` already ships. Each `issue` = `{ fingerprint,
     ruleId, kind, severity, file, count, rank, memberErrorIds }`.
   - **If issues need their own pagination/sort:** a **new** additive endpoint
     `GET /projects/{project}/issues` (new `IssueController` + request), returning
     issues in `data` under the C7 envelope. Choose this only if `meta` grows
     unwieldy; it avoids any C5 pressure entirely.
3. **Rank by impact.** Order issues by downstream blast radius (size of
   `downstream` from the reconciled resolver in `DX-41`), tie-broken by severity
   (`error` > `warning` > `info`) then count. Compute from the persisted/cached
   impact source `DX-41` provides — **never** rebuild the resolver here (that is
   the anti-pattern `DX-41` removes).
4. **Default-hide lowest tier.** Server default excludes `severity=info` from the
   issue ranking unless an explicit `includeInfo=1` (new optional
   `ListErrorsRequest` rule) is passed; the raw `/errors` rows stay unfiltered so
   nothing is lost. Web defaults to hiding `info` with a visible toggle.
5. **Wire the web to depth + pagination.** In `apps/web/src/api/client.ts` /
   `ProjectContext.tsx`, pass `depth` and follow `meta.next_cursor`
   (`apps/api/app/Support/Api/ApiResponse.php:45`–`52`). Add a depth selector (1–3,
   matching IG-13 slider convention noted in `ListErrorsRequest.php:29`–`31`) and a
   "load more" / paged control on Diagnose. (UI decomposition is `DX-43`; this task
   supplies the data wiring — coordinate so they don't conflict.)
6. **Each issue answers why/how/action.** Reuse the existing `explanation` field
   (`ErrorController.php:63`) for "why"; "one action" = the existing "Show in
   graph" / "Open in IDE" affordances (`DiagnosePage.tsx:276`–`295`).

## Acceptance criteria

- [ ] Same rule+file+kind findings collapse into one issue with a stable
      `fingerprint` and a `count` (asserted deterministic across two runs).
- [ ] Issues are exposed in `meta.issues` (or the new `/issues` endpoint) inside
      the C7 envelope; C5 error rows are byte-for-byte unchanged.
- [ ] Issues are ranked by downstream impact, then severity, then count.
- [ ] `info` findings are excluded from the default ranked view and reappear when
      `includeInfo` is set / the web toggle is on.
- [ ] Diagnose sends `depth` and paginates via cursor; the depth control and
      pagination are visible and covered by a component test.

## Files to touch

**Modify (API):**
- `apps/api/app/Http/Controllers/Api/V1/ErrorController.php` — add `meta.issues`
  (or delegate to a new controller).
- `apps/api/app/Http/Requests/ListErrorsRequest.php` — optional `includeInfo`.

**Create (API, only if the endpoint route is chosen):**
- `apps/api/app/Http/Controllers/Api/V1/IssueController.php`,
  `apps/api/app/Http/Requests/ListIssuesRequest.php`, route in
  `apps/api/routes/api.php`, and a `FindingFingerprint`/`IssueGrouper` service under
  `apps/api/app/Services/Diagnostics/`.
- Otherwise still extract `IssueGrouper` as a service so the controller stays thin.

**Modify (web):**
- `apps/web/src/api/client.ts` — `depth` arg + `meta.issues` / cursor types.
- `apps/web/src/state/ProjectContext.tsx` — pass depth, follow `next_cursor`.
- `apps/web/src/pages/DiagnosePage.tsx` — depth selector + pagination + `info`
  toggle (coordinate with `DX-43`).

## Tests to add (mirror existing test files)

- API: extend `apps/api/tests/Feature/ChainDetectionTest.php` conventions with a
  new `apps/api/tests/Feature/IssueGroupingTest.php` — fingerprint determinism,
  dedup count, impact ranking order, `info` hidden by default / shown with
  `includeInfo`.
- Web: extend `apps/web/src/pages/DiagnosePage.test.tsx` — depth control changes
  the request; pagination requests the next cursor; `info` toggle filters rows.

## Contract & security notes

- **C5 (frozen):** `packages/schemas/diagnostic-error.schema.json` has
  `additionalProperties: false`. Grouping/dedup output **must not** add fields to
  the per-error row — it lives in `meta.issues` or a new endpoint's `data`. This is
  the same additive pattern already used for `meta.chains`. **No C5 body mutation
  → no frozen-contract decision-log row needed.**
- **C7:** everything stays inside `{ data, meta, errors }`; `meta.issues` is a new
  meta key. If a new `/issues` endpoint is added it returns the standard envelope.
- **SQL safety:** fingerprint grouping runs in PHP over fetched rows or via
  parameterised aggregate queries — no string-built SQL (CI `sql-safety` gate,
  `.github/workflows/ci.yml:51`).
- **Parse-not-execute / path-jail:** unchanged; grouping reads already-persisted
  findings, touches no imported files.

## Risks / out of scope

- **Stretch (out of scope for the first slice): dismissal-with-reason + audit
  trail** (GitHub pattern). This needs new storage (a `finding_dismissals` table
  keyed by the deterministic `fingerprint`, with reason + actor + timestamp) and
  possibly a new C-contract for the audit record. **Scope it as a follow-up
  task**; if it needs a new persisted contract, that requires a vault
  decision-log row before coding. Keep it out of the grouping slice.
- **Risk:** ranking depends on `DX-41`'s reconciled impact source; do not merge
  `DX-40` before `DX-41` or it will reintroduce per-request resolver rebuilds.

## Governance

Claim `DX-40` in the vault Roadmap before coding. C5/C7 stay additive → no frozen
decision-log row for grouping. The dismissal/audit follow-up needs its own id and,
if it adds a persisted contract, a decision-log row. Id-prefixed commits; draft PR;
note-09 DoD.
