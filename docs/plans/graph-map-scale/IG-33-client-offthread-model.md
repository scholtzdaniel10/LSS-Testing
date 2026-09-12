# IG-33 — Off-thread client model building + tree virtualization

**Proposed task id:** IG-33 *(provisional — confirm/claim in the vault Roadmap
before coding; prefix commits with the claimed id)*

**Status:** Proposed

**Depends on:** — (partly independent of the backend tasks; can land against
today's `/graph` + `/tree`). Complements IG-34.

## Problem

Even before render caps apply, the client rebuilds the full graph/radial model on
the **main thread every render**, and mounts every tree row into the DOM.

- Graph: `apps/web/src/components/DependencyGraph.tsx:132-135` runs
  `buildGraphView(edges, files, errorFiles, expanded, showExternal, profile)`
  (`apps/web/src/lib/graphModel.ts:146`) inside a `useMemo`. `buildGraphView`
  builds every node and link, then caps to `MAX_NODES = 200`
  (`graphModel.ts:126,279-290`). The memo re-runs whenever `expanded`,
  `showExternal`, `errorFiles`, etc. change — all synchronously on the main
  thread.
- Map: `apps/web/src/components/CodebaseRadial.tsx:583-631` runs
  `buildFolderLayout` / `buildRadialLayout` (`apps/web/src/lib/radialModel.ts:603,216`),
  including union-find over all edges (`radialModel.ts:65-110`,
  `:244-251`) and per-component hierarchy building (`buildHierarchy`,
  `radialModel.ts:120-150`), plus `applyRadialRenderCap` (`radialModel.ts:547`) —
  all in `useMemo`s on the main thread.
- Tree: `apps/web/src/pages/ExplorePage.tsx:266-324` maps **every** node in
  `treeNodes` (`ExplorePage.tsx:168-171`, from `buildFileTree`,
  `graphModel.ts:349`) to a DOM row. On a 25k-file project the expanded tree can
  be enormous.
- `ProjectContext` holds the full `graphEdges` + `tree`
  (`apps/web/src/state/ProjectContext.tsx:58,63,140-142`), so every consumer
  recomputes from the full arrays.

The pure model functions are already well-factored and unit-tested
(`graphModel.ts`, `radialModel.ts`, `graphModel.test.ts`, `radialModel.test.ts`),
which makes them straightforward to move off-thread without changing their logic.

## Goal / success criteria

- Heavy model building (`buildGraphView`, `buildRadialLayout`/`buildFolderLayout`,
  union-find, hierarchy build) runs in a **Web Worker** (or equivalent
  off-main-thread mechanism), so the UI thread stays responsive during compute.
- Results are **memoized/cached keyed by snapshot id + view params**, so
  identical inputs don't recompute (today's `useMemo` recomputes on any dep
  change and is discarded on unmount).
- The Node-tree list is **virtualized** so only visible rows mount to the DOM.
- Strict types preserved; **all four+idle UI states** (idle / loading / ready /
  empty / error) preserved — including a *computing* affordance while the worker
  runs; vitest coverage added.
- Delivers a measurable main-thread win even without IG-31/IG-32.

## Approach

Keep the pure functions as the single source of truth; run them in a worker and
cache their outputs; virtualize the tree.

1. **Extract nothing, wrap everything.** The model functions in `graphModel.ts`
   and `radialModel.ts` are already pure and DOM-free (they take arrays, return
   arrays). Create a worker entry
   `apps/web/src/workers/modelWorker.ts` that imports these functions and exposes
   a message API:
   - `buildGraphView` inputs (edges, files, errorFiles as entries, expanded,
     showExternal, profile) → `GraphView`.
   - `buildFolderLayout` / `buildRadialLayout` inputs → `RadialLayout`
     (+ `applyRadialRenderCap` results / capped counts).
   Use Vite's native worker support (`new Worker(new URL('...', import.meta.url),
   { type: 'module' })`) — already available in the `apps/web` Vite setup.
   Serialize `Map`/`Set` inputs as arrays across the boundary (postMessage is
   structured-clone; keep payloads plain).

2. **A typed worker client hook.** Add `apps/web/src/lib/useModelWorker.ts`
   (or a small client class) that:
   - posts a job and returns `{ status: 'idle'|'computing'|'ready'|'error', data }`;
   - **caches by a key** = `snapshotId` (use `graph.data.scannedAt` /
     `projectId`, `client.ts:257`) + serialized view params (expanded set,
     showExternal, grouping mode). On cache hit, return synchronously — no worker
     round-trip.
   - cancels/supersedes stale jobs (latest params win) to avoid races when the
     user toggles quickly.
   `DependencyGraph.tsx` and `CodebaseRadial.tsx` swap their `useMemo(build…)`
   for this hook, keeping the exact same downstream rendering code.

3. **Preserve the render-cap pipeline.** The worker returns the *full* model; the
   existing caps (`graphPerformanceProfile`/`hugeGraphOverviewKeep`/
   `filterForceGraphData` in `DependencyGraph.tsx:137-179`;
   `radialPerformanceProfile`/`applyRadialRenderCap` in
   `CodebaseRadial.tsx:602-631`) continue to run — cheaply — after results
   arrive. (Once IG-34 lands, the worker mostly processes server-pre-aggregated
   slices instead of the full blob, shrinking these jobs further.)

4. **Virtualize the Node tree.** Replace the full `treeNodes.map(...)` in
   `ExplorePage.tsx:266-324` with a windowed list that renders only visible rows.
   Options: add a small dependency (e.g. `@tanstack/react-virtual`) via
   `npm install` (per the dependency policy), or a minimal hand-rolled windowing
   hook. Preserve every current affordance: chevron expand/collapse
   (`ExplorePage.tsx:298-301`, `toggleFolder` `:185-200`), focus-row
   `scrollIntoView` (`:203-210`), error/link badges (`:312-321`), selected/focus
   styling, keyboard activation (`:287-296`), `role="tree"`/`treeitem`/
   `aria-expanded`. Virtualization must not break `focusRowRef` scroll-to (compute
   the focused row's index and scroll the virtualizer to it).

5. **Loading/computing state.** While the worker computes, show a token-styled
   computing affordance in the Map/Graph panels (reuse `ScreenState`,
   `apps/web/src/components/ScreenState.tsx`, which already models
   idle/loading/ready/empty/error). Don't block the whole page — the tree can
   render (virtualized) while the graph model computes.

## Acceptance criteria (testable)

- [ ] `buildGraphView` / `buildRadialLayout` / `buildFolderLayout` run in a worker
      (no synchronous main-thread call in the render path); the UI thread is not
      blocked during compute (assert via the hook's `computing` state
      transitions).
- [ ] Worker output is **identical** to calling the pure functions directly for
      the same inputs (parity test).
- [ ] Re-rendering with unchanged snapshot id + view params does **not** recompute
      (cache hit) — assert the worker is called once.
- [ ] The Node tree renders only a windowed subset of rows for a large file set,
      while expand/collapse, focus scroll-to, badges, and keyboard nav still work.
- [ ] All four+idle UI states render correctly, including the computing state.
- [ ] `tsc` strict passes; eslint passes; `npm run test.unit` (vitest) passes;
      `npm run build` passes.

## Files to touch

- **Create** `apps/web/src/workers/modelWorker.ts` — worker wrapping the pure
  model functions.
- **Create** `apps/web/src/lib/useModelWorker.ts` — typed job/cache hook.
- **Modify** `apps/web/src/components/DependencyGraph.tsx` — use the hook instead
  of the synchronous `buildGraphView` memo (`:132-135`).
- **Modify** `apps/web/src/components/CodebaseRadial.tsx` — use the hook instead
  of the synchronous layout memos (`:583-631`).
- **Modify** `apps/web/src/pages/ExplorePage.tsx` — virtualize the tree list
  (`:266-324`); keep all affordances.
- **Modify** `apps/web/src/state/ProjectContext.tsx` — expose snapshot id
  (`scannedAt`) for cache keys if not already available (`:140-142`).
- **(If chosen)** `apps/web/package.json` — add a virtualization dependency.

## Tests to add

- **Create** `apps/web/src/lib/useModelWorker.test.ts` — cache-hit behaviour,
  stale-job supersession, error state (mock the worker; vitest supports this).
- **Create** `apps/web/src/workers/modelWorker.test.ts` (or extend
  `graphModel.test.ts` / `radialModel.test.ts`) — parity: worker handler output
  equals direct function output for shared fixtures.
- **Add** a virtualization test — for a large synthetic path list, only a bounded
  number of `treeitem` rows are in the DOM, and expanding a folder reveals its
  children. Mirror existing component/unit test conventions in
  `apps/web/src/**/*.test.ts`.

## Contract & security notes

- **Contract**: none touched — this is a **client-only** refactor of how existing
  data is processed and rendered. No API shape changes, no C1–C7 impact.
- **CLAUDE.md invariants**: design-tokens-only styling for the virtualized rows
  and computing state (reuse existing `tree__*` classes and `ScreenState`); strict
  types across the worker boundary (no `any` on postMessage payloads); no dead
  code (remove the now-unused synchronous memo paths).

## Risks / out of scope

- **Risk:** worker serialization overhead for very large edge arrays could offset
  gains. Mitigation: cache aggressively by snapshot id; and once IG-34 feeds
  pre-aggregated slices, payloads shrink dramatically. Measure with IG-35's
  model-build-time budget.
- **Risk:** virtualization breaking `scrollIntoView`/focus deep-link
  (`ExplorePage.tsx:203-210`). Mitigation: scroll the virtualizer to the focused
  index explicitly; cover with a test.
- **Out of scope:** progressive server-driven loading (IG-34); backend
  aggregation/tree endpoints (IG-31/IG-32) — this task works against today's
  full-blob APIs and simply stops blocking the UI thread.

## Governance

- Claim the real IG id in the vault Roadmap before coding; commit with that
  prefix; no `Co-Authored-By: Claude` trailer.
- No frozen-contract change (client-only).
- Definition of done per epic README (note 09): passing vitest, four+idle UI
  states, strict types, design tokens only, no dead code.
