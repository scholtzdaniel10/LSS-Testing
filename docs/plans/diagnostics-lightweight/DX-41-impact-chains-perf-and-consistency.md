# DX-41 — Impact/chains: kill the request-path cost, one source of truth

**Proposed id:** `DX-41` — *provisional; confirm/claim in the vault Roadmap
before coding.*

**Status:** Proposed

**Depends on:** — (unblocks `DX-40` and `HD-10`).

## Problem

Impact and chains are computed and **persisted at scan time**, then **recomputed
on every read**:

- Scan time: `AnalyzeProject` calls
  `$runner->applyImpactAndChains($result['scan'], $edges)`
  (`apps/api/app/Jobs/AnalyzeProject.php:98`), which persists `upstream`,
  `downstream`, `chain_id`, `is_root` per error
  (`apps/api/app/Services/Diagnostics/AnalysisRunner.php:174`–`200`).
- Read time: `ErrorController::index` **rebuilds** an `ImpactResolver` from the
  full `graph_snapshots.edges` blob on **every request**
  (`apps/api/app/Http/Controllers/Api/V1/ErrorController.php:40`–`43`) and
  recomputes `upstream`/`downstream` **per row** (`:64`–`69`), then
  `chains()` runs a **second full-table query** for chain groupings on every
  paginated request (`:81`, `:90`–`109`).

Costs:
- `ImpactResolver.__construct` is **O(E)** — it walks the whole edge list to build
  adjacency (`apps/api/app/Services/Diagnostics/ImpactResolver.php:33`–`51`); the
  pilot graph is ~6.2k edges (noted at `:66`). This runs once per `/errors` page.
- `ChainDetector::detect` is **O(N²)** pairwise union-find over errors
  (`apps/api/app/Services/Diagnostics/ChainDetector.php:47`–`57`) — used at scan
  time, but the read-path `chains()` re-queries the table each page.
- Two "chain" definitions exist (see `HD-10`): the persisted `chain_id` groups vs
  the health heuristic — this task makes the `chain_id` groups the single source.

## Goal / success criteria

- `/errors` no longer rebuilds an `ImpactResolver` from the full edge blob per
  request; impact comes from persisted values or a resolver **cached keyed by
  `graph_snapshots.id`**.
- Chain groupings are read from persisted `chain_id` (one query, or cached),
  not recomputed pairwise per page.
- Chain detection at scan time is **file-indexed connectivity** (linear-ish in
  errors+edges), replacing the O(N²) pairwise loop, with **identical semantics**.
- A single documented source of truth for "chains" that `HD-10` and `DX-40`
  consume.
- Bounded downstream traversal (depth ≤ 3) preserved.

## Approach

1. **Serve impact from persisted values by default.** The persisted `upstream`
   (full) and `downstream` are already written at scan time
   (`AnalysisRunner.php:191`–`196`). For the default view, return persisted
   `downstream` (the resolver falls back to these today when no snapshot exists —
   `ErrorController.php:64`–`69`). The `depth` param (1–3) is the only reason a
   resolver is needed on the read path.
2. **When `depth` differs, use a cached resolver keyed by snapshot id.** Build the
   `ImpactResolver` once and cache it via `ProjectReadCache`
   (`apps/api/app/Support/Cache/ProjectReadCache.php`) under a key like
   `impact:{graph_snapshots.id}` (immutable per snapshot — a new snapshot gets a
   new id at `AnalyzeProject.php:59`–`62`, and `ProjectReadCache::forgetGraph` runs
   at `:63`). This turns per-request O(E) rebuilds into one build per snapshot,
   reused across pages/filters. Cache the serializable adjacency, not a closure.
   - Alternatively cache the computed `meta.chains` payload keyed by
     `graph_snapshots.id` so `chains()` (`ErrorController.php:90`–`109`) is a cache
     hit after the first page.
3. **Chains: read persisted `chain_id`, don't recompute per page.** Keep
   `chains()` reading persisted `chain_id`/`is_root` (it already does —
   `ErrorController.php:92`–`96`) but memoize the grouped result per scan/snapshot
   so paginated requests don't re-query. This is the single source of truth other
   tasks consume.
4. **Replace O(N²) detection with file-indexed connectivity (scan time).** In
   `ChainDetector::detect`, instead of the `i<j` pairwise loop
   (`ChainDetector.php:47`–`57`), build a graph over **error files**: union two
   errors when they share a file, or when one file appears in the other's bounded
   `downstream` set (already precomputed at `:31`–`36`). Iterate each file's
   downstream set once and union member-to-member via a file→errorIds index, giving
   ~O(errors + Σ|downstream|) instead of O(N²). **Semantics must be identical**:
   same components, same root selection (root = file not downstream of any other
   member, `:79`–`93`), chains still require ≥2 members (`:66`–`71`). Lock this with
   the existing tests (see below) before and after.
5. **Preserve depth cap.** `downstream(file, depth ≤ 3)` reverse-BFS stays capped
   (`ImpactResolver.php:70`–`93`); do not remove the cap when caching.

## Acceptance criteria

- [ ] `/errors` does not construct a new `ImpactResolver` from the full edge blob
      on each request (verified: default view uses persisted values; non-default
      `depth` uses the snapshot-keyed cache — assert one build per snapshot across
      N pages).
- [ ] Chain groupings for a scan are computed/queried once and reused across
      paginated `/errors` requests (assert query/rebuild count).
- [ ] `ChainDetector` output is byte-identical to the current implementation on
      the existing fixtures (chain membership, root flags) with the new
      file-indexed algorithm.
- [ ] Downstream traversal remains capped at depth ≤ 3.
- [ ] Documented single source of truth for chains (persisted `chain_id` groups)
      referenced by `HD-10` and `DX-40`.

## Files to touch

**Modify (API):**
- `apps/api/app/Http/Controllers/Api/V1/ErrorController.php` — stop per-request
  resolver rebuild; use persisted values / snapshot-keyed cache; memoize chains.
- `apps/api/app/Services/Diagnostics/ChainDetector.php` — file-indexed connectivity.
- `apps/api/app/Support/Cache/ProjectReadCache.php` — add `impact:{snapshotId}` (or
  `chains:{snapshotId}`) key + a `forgetImpact`/reuse in `forgetGraph`.
- Possibly `apps/api/app/Services/Diagnostics/ImpactResolver.php` — a
  `toArray()`/`fromArray()` for cacheable adjacency (no behavior change to
  `upstream`/`downstream`).

## Tests to add (mirror existing test files)

- Extend `apps/api/tests/Unit/ImpactResolverTest.php` — adjacency round-trips
  through cache serialization; depth cap unchanged.
- Extend `apps/api/tests/Feature/ChainDetectionTest.php` — new algorithm equals old
  output on fixtures (membership + roots + ≥2-member rule); add a scan with a known
  chain and assert stable `chain_id` grouping.
- Extend `apps/api/tests/Feature/ImpactResolutionTest.php` — `/errors` across
  multiple pages builds the resolver at most once per snapshot; `depth=1..3` still
  correct.

## Contract & security notes

- **C5/C7:** response shape unchanged — same C5 rows, same `meta.chains`/`meta.depth`
  keys (`ErrorController.php:78`–`82`). Pure performance/consistency work → **no
  frozen-contract change, no decision-log row.**
- **C3 (dependency edge):** edges are read, not modified.
- **SQL safety:** chain memoization uses the query builder with bindings; no
  string-built SQL (CI gate `.github/workflows/ci.yml:51`).
- **Parse-not-execute / path-jail:** no imported code executed; only persisted rows
  and cached adjacency touched.

## Risks / out of scope

- **Risk:** cache staleness — key strictly by `graph_snapshots.id` (immutable) and
  invalidate via the existing `ProjectReadCache::forgetGraph`
  (`ProjectReadCache.php:28`–`32`, already called at `AnalyzeProject.php:63`).
- **Risk:** the file-indexed rewrite could drift from the O(N²) semantics — the
  equality test on fixtures is the guardrail; do not merge without it.
- **Out of scope:** symbol-level impact (edges carry no `symbol` yet —
  `ImpactResolver.php:9`–`15`); grouping/triage (`DX-40`).

## Governance

Claim `DX-41` in the vault Roadmap before coding. No frozen-contract surface
changes (response shapes preserved). Id-prefixed commits; draft PR; note-09 DoD.
