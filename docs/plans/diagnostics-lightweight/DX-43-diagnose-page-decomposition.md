# DX-43 — Decompose the monolithic Diagnose page

**Proposed id:** `DX-43` — *provisional; confirm/claim in the vault Roadmap
before coding.*

**Status:** Proposed

**Depends on:** — (independent refactor; parallelizable with `DX-41`/`DX-42`/`DX-44`).
Coordinate with `DX-40`, which adds depth/pagination controls to the same page.

## Problem

`apps/web/src/pages/DiagnosePage.tsx` is ~417 lines and mixes several
responsibilities in one component:

- Inline row renderer `renderRow` (`DiagnosePage.tsx:122`–`179`).
- The impact/chain popover markup (`:319`–`404`).
- The file-fetch `useEffect` that loads source lines (`:81`–`117`).
- Chain grouping/derivation via `groupByChain` + active-chain lookup
  (`:51`–`54`), expand/collapse state (`:45`, `:56`–`62`), and chain walking
  (`:65`–`68`).

This makes the page hard to read, hard to test in isolation, and risky to change
(e.g. when `DX-40` wires in pagination/depth). It works, but "works" is not "done"
(CLAUDE.md quality bar).

Research basis (progressive disclosure ≤3 levels; redundant color+icon+text
severity): a decomposed structure makes the disclosure levels
(list → row → detail/popover) explicit and independently testable.

## Goal / success criteria

- `DiagnosePage.tsx` becomes a thin container; the row list, the detail/source
  pane, and the impact popover are focused child components.
- **No behavior change** — same rendering, same chain grouping, same navigation,
  same file fetching.
- All four UI states enforced via `ScreenState`
  (`apps/web/src/components/ScreenState.tsx`); strict TypeScript (no `any`).
- vitest coverage mirrors existing web tests.

## Approach

1. **`FindingsList`** — owns the grouped list: renders chain groups (root-cause
   first, expandable) and unchained findings, taking `errors`, `chains`,
   `activeId`, and `onSelect`. Move `renderRow` (`DiagnosePage.tsx:122`–`179`),
   the chain-group mapping (`:238`–`264`), and expand/collapse state
   (`:45`, `:56`–`62`) here.
2. **`FindingDetail`** — owns the right pane: file header + actions ("Show in
   graph"/"Open in IDE", `:276`–`295`), the source `code-pane` slice, and the
   file-fetch effect (`:81`–`117`). Takes the active `DiagnosticFinding` and
   `project`.
3. **`ImpactPopover`** — owns the upstream/downstream/chain-walk popover
   (`:319`–`404`), taking the active finding, `errors`, the active chain, and an
   `onWalkTo` callback.
4. **Container `DiagnosePage`** — keeps the analyser-panel header
   (`:181`–`220`), the `ScreenState` wrapper (`:222`–`226`), active-selection
   state, and wires the three children. Preserve `useProject()` usage
   (`:40`) and the `useEntrance` animation ref (`:39`).
5. **Types.** Reuse `DiagnosticFinding` / `ErrorChain` / `AnalyserStatuses` from
   `apps/web/src/api/client.ts`; extract shared prop types. No `any`, no
   non-null-assertion hacks.
6. **Keep chain helpers where they are.** `groupByChain`/`findingForFile` stay in
   `apps/web/src/lib/chainModel.ts`; components import them (no logic moved into
   components).

## Acceptance criteria

- [ ] `DiagnosePage.tsx` is a container that renders `FindingsList`,
      `FindingDetail`, and `ImpactPopover`; each child is its own file with typed
      props.
- [ ] Rendered output and interactions are unchanged: chain groups (root first),
      expand/collapse, row selection, "Show in graph"/"Open in IDE", source slice,
      upstream/downstream/chain-walk popover.
- [ ] Idle/loading/ready/empty/error states all handled via `ScreenState`
      (empty = ready with zero findings, as today at `:223`).
- [ ] Strict TypeScript — no `any`, no `@ts-ignore`; components use design tokens
      only (no raw hex; reuse existing `var(--…)` tokens as in the current file).
- [ ] vitest coverage for each new component.

## Files to touch

**Create (web):**
- `apps/web/src/pages/diagnose/FindingsList.tsx`
- `apps/web/src/pages/diagnose/FindingDetail.tsx`
- `apps/web/src/pages/diagnose/ImpactPopover.tsx`

**Modify (web):**
- `apps/web/src/pages/DiagnosePage.tsx` — reduce to a container.

## Tests to add (mirror existing test files)

- Extend/refactor `apps/web/src/pages/DiagnosePage.test.tsx` so its existing
  assertions still pass against the container.
- Add `apps/web/src/pages/diagnose/FindingsList.test.tsx`,
  `FindingDetail.test.tsx`, `ImpactPopover.test.tsx` — chain grouping renders root
  first + expand toggles; detail pane fetches + renders source and handles the
  binary/missing-on-disk/unavailable branches (`DiagnosePage.tsx:92`–`100`);
  popover walks to upstream/downstream/chain members.

## Contract & security notes

- **No API/contract impact** — pure frontend refactor; no `/api/v1` calls change
  shape, C5/C7 untouched. **No decision-log row.**
- **Security:** unchanged — the page renders API data; source viewing goes through
  the existing `api.file` endpoint (`DiagnosePage.tsx:90`), which is where
  path-jail is enforced server-side. Do not add new file access on the client.

## Risks / out of scope

- **Risk:** behavior drift during extraction (e.g. popover positioning at
  `:319`–`322`, active auto-select at `:77`–`79`). Mitigation: keep the existing
  `DiagnosePage.test.tsx` green throughout; extract incrementally.
- **Coordination:** `DX-40` adds a depth selector + pagination + `info` toggle to
  this page. Sequence so one lands cleanly on the other (either land `DX-43` first
  and add controls into the new components, or rebase). Note the dependency in the
  vault when claiming.
- **Out of scope:** visual redesign, new severity iconography beyond current
  `SeverityPill` usage (`:138`), data-fetching changes (that's `DX-40`).

## Governance

Claim `DX-43` in the vault Roadmap before coding. No frozen-contract surface
changes. Id-prefixed commits; draft PR; note-09 DoD (no dead code — the old inline
functions must be removed, not left alongside the components).
