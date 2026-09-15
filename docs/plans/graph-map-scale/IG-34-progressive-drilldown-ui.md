# IG-34 — Progressive drill-down UI for Map + Graph

**Proposed task id:** IG-34 *(provisional — confirm/claim in the vault Roadmap
before coding; prefix commits with the claimed id)*

**Status:** Proposed

**Depends on:** IG-31 (aggregation endpoints, required) and IG-32 (lazy tree,
strongly recommended). Benefits from IG-33 (off-thread compute) but does not
require it.

## Problem

Both views load the whole project up front and only then reduce it for display —
there is no path that fetches *just* the overview, then *just* a neighbourhood on
demand.

- `apps/web/src/state/ProjectContext.tsx:135-147` — `ensureExploreData()` eagerly
  loads the full graph + tree via `Promise.all([api.graph(id), api.tree(id)])`
  and stores them (`ProjectContext.tsx:140-142`).
- Graph: `DependencyGraph.tsx` gets the full `edges`/`files`
  (`apps/web/src/components/DependencyGraph.tsx:70-79`) and computes an overview
  (`hugeGraphOverviewKeep`, `DependencyGraph.tsx:156-159`) or a focus
  neighbourhood (`cappedNeighbourhood`, `:148-154`) **client-side** from the full
  set.
- Map: `CodebaseRadial.tsx` builds folder/component layouts and a drill circle
  (`buildDrillComponent`, `apps/web/src/lib/radialModel.ts:677`) — again from the
  full edge set (`CodebaseRadial.tsx:571-596`).

IG-31 moves exactly these computations server-side; this task makes the UI
consume them so the browser never needs the whole project.

## Goal / success criteria

- Map and Graph **start at a folder/module overview** (from
  `GET …/graph/rollup` or `…/graph/overview`) rather than the full edge set.
- **Drill down on demand**: expanding a folder / focusing a node fetches the
  neighbourhood/subgraph (`…/graph/neighbourhood`) or folder children
  (`…/tree/children`) instead of relying on preloaded data.
- All existing UX affordances are preserved: search, focus depth, expand/collapse
  breadcrumbs, Map/Graph toggle, grouping mode, drill mode, "Show all", legend.
- Design-token styling and all four+idle UI states throughout; new fetches have
  their own loading/error handling.

## Approach

Introduce a progressive data layer, then point both components at it, keeping
their rendering internals intact.

1. **Progressive data source.** Add a hook/context method (extend
   `ProjectContext` or add `apps/web/src/state/useGraphExplorer.ts`) that exposes:
   - `overview()` → `GET …/graph/overview` (or `rollup` for Map) — the initial
     slice; replaces the eager full `api.graph` load for Explore.
   - `neighbourhood(nodeId, hops)` → `GET …/graph/neighbourhood` — fetched when a
     node is focused/expanded; cached by `(snapshotId, nodeId, hops)`.
   - `folderChildren(path, cursor?)` → `GET …/tree/children` (IG-32) — fetched
     when a tree/Map folder is expanded.
   Use the typed client methods added in IG-31 (`graphRollup`,
   `graphNeighbourhood`, `graphOverview`) and IG-32 (`treeChildren`). Cache
   results (reuse IG-33's cache-by-key approach if present).

2. **Graph view.** In `DependencyGraph.tsx`:
   - Seed from the server **overview** instead of computing
     `hugeGraphOverviewKeep` over the full set (`:156-159`).
   - On node focus (`focusNode`/`activateNode`, `:290-330`) and on the depth
     slider (`focusDepth`, `:646-658`), call `neighbourhood(selected, focusDepth)`
     and merge the returned nodes/links into the view instead of computing
     `cappedNeighbourhood` locally (`:148-154`). Keep `buildNeighbourMap`,
     dimming, cluster layout, and paint code unchanged — they operate on whatever
     nodes/links are present.
   - Folder drill (`focusNode` on a folder, `:290-299`) fetches that folder's
     rollup/children rather than expanding from a preloaded `files` list.
   - Preserve search (`searchGraphNodes`, `:208-211`): search over the currently
     loaded nodes; for misses, fall back to a server node lookup (a thin
     addition, or reuse `…/tree/children`/a search param) so search still finds
     files not yet loaded.

3. **Map view.** In `CodebaseRadial.tsx`:
   - Seed folder circles from `GET …/graph/rollup` (folder nodes + weighted
     links) instead of `buildFolderLayout` over all edges (`:583-589`).
   - Drill mode (`drillMode`/`drillChain`, `:462-479`, `handleFileClick`
     `:640-648`) fetches `neighbourhood(file)` and renders it as the drill circle
     — the server returns the same "focus + direct neighbours" set that
     `buildDrillComponent` (`radialModel.ts:677`) computes today.
   - Keep grouping toggle (`:778-816`), drill breadcrumbs (`:866-913`), unlinked
     list, zoom/pan, legend — all unchanged; they render whatever components are
     supplied.

4. **Tree.** With IG-32, expand a folder in `ExplorePage.tsx` (`toggleFolder`,
   `:185-200`) by fetching `folderChildren(path)` and merging into the tree model
   rather than deriving from a fully-loaded `allFilePaths` (`:122-127`). Combine
   with IG-33 virtualization so only visible rows render.

5. **Backward-compat / feature flag.** Keep the current full-load path working
   behind a flag (e.g. `config`-style constant or `localStorage`, matching the
   `lss.radial.*` pattern in `CodebaseRadial.tsx:440-441`) so the app degrades to
   today's behaviour if the new endpoints are unavailable (e.g. an older API).
   Detect endpoint availability and fall back to `api.graph`/`api.tree`.

6. **New UI states for fetches.** Each drill/expand fetch shows a token-styled
   inline loading indicator and an error affordance (reuse `ScreenState` /
   `panel__hint` patterns). Empty neighbourhoods render an explicit empty state,
   not a blank canvas.

## Acceptance criteria (testable)

- [ ] Opening Explore issues an **overview/rollup** request, not a full-edge
      `api.graph` load, and renders the overview.
- [ ] Focusing a node (or moving the depth slider) issues a `neighbourhood`
      request and renders the returned subgraph; repeated focus on the same node
      + hops is served from cache (no duplicate request).
- [ ] Expanding a Map folder / tree folder issues a `rollup`/`children` request
      and merges results; collapse restores prior state.
- [ ] Search, focus depth, breadcrumbs, Map/Graph toggle, grouping mode, drill
      mode, "Show all", legend all still work.
- [ ] Each fetch has loading + error + empty states, styled with design tokens.
- [ ] With the fallback flag on (or endpoints absent), the app behaves like today
      (full load) — no regression.
- [ ] `tsc` strict, eslint, `npm run test.unit`, `npm run build` all pass.

## Files to touch

- **Modify** `apps/web/src/state/ProjectContext.tsx` — progressive data methods;
  stop eager full-load for Explore (`:135-147`).
- **Create** `apps/web/src/state/useGraphExplorer.ts` (optional) — overview /
  neighbourhood / children fetch + cache layer.
- **Modify** `apps/web/src/components/DependencyGraph.tsx` — consume overview +
  neighbourhood; keep render internals.
- **Modify** `apps/web/src/components/CodebaseRadial.tsx` — consume rollup +
  drill neighbourhood.
- **Modify** `apps/web/src/pages/ExplorePage.tsx` — lazy folder expansion via
  `treeChildren`.
- **Modify** `apps/web/src/api/client.ts` — ensure the IG-31/IG-32 client methods
  exist and are typed (add here if not already).

## Tests to add

- **Create** component tests for `DependencyGraph` and `CodebaseRadial` (mock the
  new API methods) asserting: overview fetched on mount, neighbourhood fetched on
  focus, cache reuse, fallback path, and all UI states. Mirror existing web test
  conventions (`apps/web/src/**/*.test.ts(x)`).
- **Extend** `apps/web/src/lib/graphModel.test.ts` / `radialModel.test.ts` only if
  helpers are refactored for merge-on-drill.

## Contract & security notes

- **Contract**: consumes the **additive** endpoints from IG-31/IG-32; the
  existing `/graph` + `/tree` are used only as the compatibility fallback. No
  frozen-contract change. The C3 edge shape
  (`packages/schemas/dependency-edge.schema.json`) is not modified.
- **CLAUDE.md invariants**: no filesystem/SQL involvement client-side; all data
  arrives via the enveloped API; design-tokens-only styling; strict types on all
  new fetch/response types.

## Risks / out of scope

- **Risk:** interaction latency if each focus waits on a network round-trip.
  Mitigation: cache by key (IG-33/here), prefetch likely-next neighbourhoods for
  the current selection, and keep the overview resident.
- **Risk:** search discoverability when data is loaded lazily (a file not yet
  fetched won't be in local nodes). Mitigation: server-assisted node search
  fallback (step 2).
- **Out of scope:** the endpoints themselves (IG-31/IG-32); worker/virtualization
  mechanics (IG-33); extraction (IG-30).

## Governance

- Claim the real IG id in the vault Roadmap before coding; commit with that
  prefix; no `Co-Authored-By: Claude` trailer.
- No frozen-contract change (consumes additive endpoints; keeps fallback).
- Definition of done per epic README (note 09): passing vitest, four+idle UI
  states for every new fetch path, strict types, design tokens only, no dead code.
