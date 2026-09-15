# IG-31 — Server-side graph aggregation endpoints

**Proposed task id:** IG-31 *(provisional — confirm/claim in the vault Roadmap
before coding; prefix commits with the claimed id)*

**Status:** Proposed

**Depends on:** IG-30 (more/better edge coverage to aggregate over). Unblocks
IG-34.

## Problem

The client is forced to download the entire edge set and do all rollup/ranking
itself, because the server offers exactly one graph endpoint that returns
everything.

- `apps/api/app/Http/Controllers/Api/V1/GraphController.php:15-39` — `show()`
  returns `{ projectId, scannedAt, edges }` with the **whole** `graph_snapshots.edges`
  blob (`GraphController.php:29`), fronted by `ProjectReadCache`.
- The client then rebuilds the whole model and *only then* caps it:
  `buildGraphView` (`apps/web/src/lib/graphModel.ts:146`) builds all nodes/links
  then hard-caps to `MAX_NODES = 200` (`graphModel.ts:126`);
  `hugeGraphOverviewKeep` (`graphModel.ts:556`) ranks folder hubs + top-degree
  files for the initial overview; `cappedNeighbourhood` (`graphModel.ts:618`)
  computes an N-hop focus subgraph. All of this runs on the client over the full
  edge array.
- The radial Map does the same: `buildFolderLayout` / `buildRadialLayout`
  (`apps/web/src/lib/radialModel.ts:603,216`) fold **all** edges into folder
  rollups and connected components client-side.

The server already has everything it needs to do this rollup once and serve
small, ranked slices — which is what this task adds, **additively**.

## Goal / success criteria

Add three **new** read endpoints (existing `/graph` untouched) so the client can
render an overview and drill down without ever holding the full edge set:

- **(a) Folder/module rollup graph** — nodes = folders/modules, edges = weighted
  aggregate links between them. Mirrors what `buildFolderLayout` and the folder
  collapsing in `buildGraphView` (`graphModel.ts:131-234`) compute today.
- **(b) Node-neighbourhood subgraph** — edges within N hops of a given node,
  capped + ranked. Server-side equivalent of `cappedNeighbourhood`
  (`graphModel.ts:618`) + `neighbourhoodWithin` (`graphModel.ts:593`).
- **(c) Top-N / most-connected subgraph** — the initial overview slice. Server
  equivalent of `hugeGraphOverviewKeep` (`graphModel.ts:556`).

All responses use the C7 envelope `{ data, meta, errors }` and bounded sizes.

## Approach

Reuse the C3 edge blob as the source of truth; compute rollups in a dedicated
service; front results with `ProjectReadCache` keyed by snapshot id.

1. **New service** `apps/api/app/Services/Graph/GraphAggregator.php` that takes
   the latest `graph_snapshots.edges` and produces the three views. Keep the
   ranking/rollup rules aligned with the client helpers so results match:
   - folder key derivation mirrors `folderOf` (`graphModel.ts:65-70`) /
     `folderKeyOf` (`radialModel.ts:585`);
   - external-ref handling mirrors `isExternalRef` (`graphModel.ts:72-73`);
   - overview ranking mirrors `hugeGraphOverviewKeep` (folder hubs + error files
     + externals kept, then top file nodes by degree — `graphModel.ts:556-574`);
   - neighbourhood BFS mirrors `neighbourhoodWithin` / `cappedNeighbourhood`
     (hops clamped 1–3, ranked by errors then degree — `graphModel.ts:600-640`).

2. **New endpoints** in a new `GraphAggregateController` (keep `GraphController`
   single-purpose), registered under the existing authed `/api/v1` group next to
   `GET /projects/{project}/graph` (`apps/api/routes/api.php:45`):

   | Method & path | Purpose | Key query params |
   |---|---|---|
   | `GET /projects/{project}/graph/rollup` | (a) folder/module graph | `depth` (path depth to roll up to, default 1) |
   | `GET /projects/{project}/graph/neighbourhood` | (b) N-hop subgraph | `node` (required), `hops` (1–3, default 2), `limit` (cap, default e.g. 200) |
   | `GET /projects/{project}/graph/overview` | (c) top-N subgraph | `limit` (default e.g. 200) |

   Use `FormRequest`s to validate + clamp params (mirror existing
   `FileContentRequest`) so `node` is validated and `hops`/`limit` are bounded —
   this also keeps the neighbourhood BFS cost bounded server-side.

3. **Response shapes** (envelope `data`), designed to be directly renderable and
   to line up with the existing web model types
   (`ForceGraphNode`/`ForceGraphLink`, `graphModel.ts:89-116`):

   - **rollup** `data`:
     ```jsonc
     {
       "projectId": "…",
       "scannedAt": "…",
       "nodes": [ { "id": "dir:app", "kind": "folder", "folder": "app", "fileCount": 128, "errors": 3 } ],
       "links": [ { "source": "dir:app", "target": "dir:system", "weight": 42, "externalTarget": false } ]
     }
     ```
   - **neighbourhood** `data`: `{ projectId, scannedAt, root, hops, nodes[], links[] }`
     with the same node/link element shapes, `nodes[]` file-level.
   - **overview** `data`: `{ projectId, scannedAt, nodes[], links[] }`, the ranked
     top-N kept set.
   - `meta` on each carries caps + truncation:
     `{ total, returned, truncated, cap }` so the client can show "showing N of
     M". This mirrors the `overviewKeep`/`capped` hints already rendered in
     `DependencyGraph.tsx:598-603` and `CodebaseRadial.tsx:745-751`.

4. **Pagination / caps.** These are ranked slices, not full lists, so bound them
   with `limit` + a hard server maximum (config `graph.aggregate_max_nodes`)
   rather than offset pagination — ranking makes offset paging meaningless. The
   `meta.truncated` flag tells the client more exists; drill-down (IG-34) fetches
   the next neighbourhood rather than the next page.

5. **Caching.** Front each view with `ProjectReadCache` (as `GraphController`
   does — `GraphController.php:17`) under keys like
   `graph:{id}:rollup:{depth}`, `graph:{id}:overview:{limit}`,
   `graph:{id}:nbhd:{node}:{hops}:{limit}`. Invalidate on rescan alongside the
   existing `ProjectReadCache::forgetGraph($project->id)` call in
   `AnalyzeProject.php:63` (extend `forgetGraph` to clear the derived keys, or add
   a tag/prefix sweep).

6. **Client wiring is IG-34**, but add the typed client methods here so IG-33/34
   can consume them: extend `apps/web/src/api/client.ts` (near `graph`,
   `client.ts:256`) with `graphRollup`, `graphNeighbourhood`, `graphOverview`
   returning the new shapes. Keep `GraphEdge` (`client.ts:102`) unchanged.

## Acceptance criteria (testable)

- [ ] `GET …/graph/overview?limit=N` returns ≤ N nodes, keeps all folder hubs +
      error files + externals first, then top-degree files — matching
      `hugeGraphOverviewKeep` selection for the same input.
- [ ] `GET …/graph/neighbourhood?node=X&hops=2` returns exactly the ≤2-hop
      subgraph of X (root included), capped by `limit`, ranked errors-then-degree
      — matching `cappedNeighbourhood` for the same input.
- [ ] `GET …/graph/rollup` returns folder nodes with correct `fileCount` and
      weighted inter-folder links — matching `buildFolderLayout` weights for the
      same input.
- [ ] Invalid `node`, out-of-range `hops`/`limit` are rejected/clamped via
      FormRequest (422 or clamped, per convention).
- [ ] All three use the `{ data, meta, errors }` envelope and report
      `meta.truncated` correctly.
- [ ] Results are cache-fronted and invalidated on rescan.
- [ ] Pint + Pest green; `sql-safety` gate green (aggregation is in-PHP over the
      jsonb blob — no raw SQL string-building).

## Files to touch

- **Create** `apps/api/app/Services/Graph/GraphAggregator.php` — rollup /
  neighbourhood / overview computation.
- **Create** `apps/api/app/Http/Controllers/Api/V1/GraphAggregateController.php`.
- **Create** request classes under `apps/api/app/Http/Requests/`
  (e.g. `GraphNeighbourhoodRequest`, `GraphOverviewRequest`) mirroring
  `FileContentRequest`.
- **Modify** `apps/api/routes/api.php` — three routes in the authed `/v1` group.
- **Modify** `apps/api/app/Support/Cache/ProjectReadCache.php` — derived-key
  invalidation for the new views.
- **Create** `apps/api/config/graph.php` (or extend the one from IG-30) —
  `aggregate_max_nodes`, default limits.
- **Modify** `apps/web/src/api/client.ts` — typed `graphRollup` /
  `graphNeighbourhood` / `graphOverview` methods (consumed in IG-34).
- **(If formalising shapes)** add `packages/schemas/graph-aggregate.schema.json`
  — see governance.

## Tests to add

- **Create** `apps/api/tests/Unit/GraphAggregatorTest.php` — pure unit tests over
  hand-built edge arrays asserting rollup weights, neighbourhood BFS + cap, and
  overview ranking (mirror the assertion style of
  `apps/web/src/lib/graphModel.test.ts` / `radialModel.test.ts`, which already
  test the equivalent client logic — reuse the same tiny fixtures so parity is
  provable).
- **Create** `apps/api/tests/Feature/GraphAggregateControllerTest.php` — envelope
  shape, param validation/clamping, `meta.truncated`, cache behaviour (mirror
  existing feature tests under `apps/api/tests/`).
- **Extend** `apps/web/src/lib/graphModel.test.ts` if any client-side helper is
  refactored to be shared with the drill-down consumer.

## Contract & security notes

- **C3**: the existing `/graph` endpoint and the edge object shape
  (`packages/schemas/dependency-edge.schema.json`) are **unchanged**. These are
  **new** endpoints returning **derived** aggregate views (nodes/links), not raw
  C3 edges — additive by construction.
- **New payload shapes**: the rollup/neighbourhood/overview `data` shapes are new
  aggregate contracts. If the team wants them schema-governed like C1–C7, add
  `packages/schemas/graph-aggregate.schema.json` and a decision-log row (this is
  a *new* schema, not a change to a frozen one — lower governance bar, but still
  flag it). Wiring schemas into both apps remains the PLT-9 concern.
- **CLAUDE.md invariants**: aggregation reads the already-parsed jsonb edge blob
  (no code execution, no filesystem access → path-jail N/A here); all DB access
  via Eloquent/query-builder (no string-built SQL — `sql-safety` gate); no target
  credentials involved.

## Risks / out of scope

- **Risk:** client/server ranking drift — the overview looks different depending
  on which computed it. Mitigation: share the exact tie-break rules and cover
  both with the *same* fixtures (client vitest + server Pest) so parity is
  asserted.
- **Risk:** neighbourhood BFS cost on dense hubs — bounded by `hops` clamp (1–3)
  and `limit`; ranking is O(n log n) on the kept set.
- **Out of scope:** the UI that consumes these (IG-34); moving client compute to
  a worker (IG-33); changing extraction (IG-30).

## Governance

- Claim the real IG id in the vault Roadmap before coding; commit with that
  prefix; no `Co-Authored-By: Claude` trailer.
- No frozen-contract change (additive endpoints). If new aggregate schemas are
  added to `packages/schemas`, note it in the vault Roadmap decision log.
- Definition of done per epic README (note 09): passing Pest + vitest parity
  tests, strict types, no dead code; any UI added later (IG-34) carries the four
  UI states + design tokens.
