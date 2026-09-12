# IG-32 — Lazy / paginated file-tree endpoint

**Proposed task id:** IG-32 *(provisional — confirm/claim in the vault Roadmap
before coding; prefix commits with the claimed id)*

**Status:** Proposed

**Depends on:** — (independent; unblocks IG-34 alongside IG-31)

## Problem

The file tree is shipped whole, so a large program sends up to 25 000 rows in a
single response and the client mounts them all.

- `apps/api/app/Http/Controllers/Api/V1/ProjectFileController.php:18-36` —
  `tree()` returns the **entire** file list, ordered by path, unpaginated. It
  annotates `meta.count` (`ProjectFileController.php:33-35`) but has no limit.
- The index can hold up to `LocalDirectoryScanner::MAX_FILES = 25_000`
  (`apps/api/app/Services/Import/LocalDirectoryScanner.php:18`).
- Client-side, `ProjectContext.ensureExploreData()` loads the whole tree into
  React state (`apps/web/src/state/ProjectContext.tsx:140-142`), and
  `ExplorePage` builds every visible row into the DOM
  (`apps/web/src/pages/ExplorePage.tsx:266-324`) with no virtualization; the
  radial Map also consumes the full `files` list
  (`apps/web/src/components/CodebaseRadial.tsx:571`).
- The API client `tree()` fetches the full array
  (`apps/web/src/api/client.ts:271`, type `TreeFile`, `client.ts:133`).

## Goal / success criteria

- Add an **additive** lazy/paginated tree API so the client is not shipped 25k
  rows at once, and can fetch a folder's children (or a page) on demand.
- Provide a `count` / `truncated` signal so the UI can show totals honestly.
- Keep path-jail; keep the existing `GET /tree` working unchanged until the web
  migrates (IG-33/IG-34).

## Approach

Add a children-of-path listing plus pagination, backed by DB queries that use
the existing Postgres path-prefix index.

1. **New endpoint** in `ProjectFileController` (additive method), registered next
   to the existing `GET /projects/{project}/tree`
   (`apps/api/routes/api.php:40`):

   `GET /projects/{project}/tree/children`

   | Query param | Meaning | Default / bound |
   |---|---|---|
   | `path` | parent folder (project-relative); empty = root | `""` |
   | `limit` | max entries returned | default e.g. 500, hard-capped |
   | `cursor` | opaque pagination cursor (last path seen) | none |

   `data` returns the **immediate** children of `path` — folders and files at
   that level — so the tree loads one level at a time:
   ```jsonc
   {
     "path": "app",
     "entries": [
       { "path": "app/Http", "name": "Http", "kind": "folder", "childCount": 12 },
       { "path": "app/User.php", "name": "User.php", "kind": "file", "size": 812, "lang": "php" }
     ]
   }
   ```
   `meta`: `{ count, truncated, nextCursor }`.

2. **Deriving children from the flat `project_files` table.** Rows are flat
   `path` strings (`project_files`, migration `:19-28`). Compute the immediate
   children of a prefix with a bounded query:
   - files directly under `path` (`path LIKE 'app/%'` with no further `/`), using
     the Postgres `project_files (project_id, path text_pattern_ops)` index
     (`2026_07_20_000001_optimize_for_postgres.php:84-86`); on SQLite fall back to
     an ordered `where('path', 'like', ...)` scan (CI/Pest only).
   - immediate sub-folders derived by taking the next path segment after the
     prefix and de-duplicating, with `childCount`.
   Do this with the query builder / bound `where(...)` — **no string-built SQL**
   (the `sql-safety` gate, `.github/workflows/ci.yml:51-69`, rejects
   interpolated raw SQL; `LIKE` bindings must be parameters).

3. **Pagination fallback.** Also accept `limit`/`cursor` on the flat listing so a
   caller that wants a paginated *flat* slice (e.g. for search) can use the same
   endpoint or a sibling `GET /tree?limit=&cursor=`. Prefer cursor (last-path)
   over offset for stable paging on large ordered sets. `respondPaginated`
   already exists on the base controller (`Controller.php:23-26`) if a
   `LengthAwarePaginator` shape is preferred — but cursor paging avoids
   `COUNT(*)` on huge tables; pick one and document it.

4. **Path-jail.** Validate `path` via a FormRequest that rejects traversal
   (`..`, NUL, absolute paths) before it touches the query — the same jail
   discipline as `ProjectWorkspace::resolve` used by
   `ProjectFileController::show` (`ProjectFileController.php:44`). This endpoint
   only reads `project_files` rows (never the filesystem), but still reject
   malformed prefixes so nothing leaks cross-project (queries are always scoped by
   `project_id`).

5. **`count` / `truncated`.** `meta.count` = total children at this level;
   `meta.truncated` = true when more than `limit` exist (with `nextCursor`). The
   existing `GET /tree` keeps returning `meta.count` as today
   (`ProjectFileController.php:33`) so nothing regresses.

6. **Caching.** Front per-folder listings with `ProjectReadCache` keyed by
   `tree:{id}:children:{path}:{cursor}` and invalidate on rescan alongside the
   existing `tree:{id}` warm/forget in `AnalyzeProject::warmReadCaches`
   (`AnalyzeProject.php:248-251`).

7. **Client method (for IG-33/34).** Add `treeChildren(id, path, cursor?)` to
   `apps/web/src/api/client.ts` (near `tree`, `client.ts:271`) returning the new
   shape. Leave `tree()` in place.

## Acceptance criteria (testable)

- [ ] `GET …/tree/children?path=app` returns only the immediate children of
      `app/` (folders + files at that level), with correct `childCount` on
      folders.
- [ ] `path=""` (root) returns top-level entries only.
- [ ] `limit` bounds the response; `meta.truncated` + `meta.nextCursor` allow
      fetching the rest; paging is stable across calls.
- [ ] Traversal / malformed `path` (`..`, absolute, NUL) is rejected; queries are
      always scoped to the project (no cross-project leakage).
- [ ] Existing `GET /tree` response is byte-identical to today (no regression).
- [ ] Pint + Pest green; `sql-safety` gate green (all `LIKE`/filters are bound
      parameters).

## Files to touch

- **Modify** `apps/api/app/Http/Controllers/Api/V1/ProjectFileController.php` —
  additive `children()` (and optional paginated flat `tree`).
- **Create** `apps/api/app/Http/Requests/TreeChildrenRequest.php` — validate +
  jail `path`, clamp `limit`.
- **Modify** `apps/api/routes/api.php` — `GET /projects/{project}/tree/children`.
- **Modify** `apps/api/app/Support/Cache/ProjectReadCache.php` — per-folder cache
  keys + invalidation.
- **Modify** `apps/web/src/api/client.ts` — `treeChildren` method + `TreeChildren`
  types (consumed in IG-33/IG-34).

## Tests to add

- **Create** `apps/api/tests/Feature/ProjectFileTreeChildrenTest.php` — children
  correctness, root listing, limit/cursor paging, path-jail rejection,
  project scoping. Mirror existing `ProjectFileController` feature tests and use
  fixtures under `apps/api/tests/fixtures/` (e.g. `ci3-mini`, `mixed-lang`) or a
  seeded `project_files` set.
- **Regression**: assert existing `GET /tree` output unchanged.

## Contract & security notes

- **Contract**: `GET /tree`'s response is a C7-enveloped behavioural surface (not
  one of the C1–C7 payload schemas). It stays **unchanged**; this task adds a
  **new** endpoint. No frozen-schema change. If the team wants to eventually
  deprecate the full `/tree`, that is a separate decision-log item once the web
  fully migrates (IG-34).
- **CLAUDE.md invariants**: path-jail enforced on `path` input; queries scoped by
  `project_id`; bound-parameter `LIKE` only (no string-built SQL); imported files
  are never executed (this endpoint only reads DB rows).

## Risks / out of scope

- **Risk:** `childCount` / sub-folder derivation from flat paths can be costly if
  done naïvely per request. Mitigation: use the path-prefix index + cache
  per-folder results; only compute one level at a time.
- **Risk:** cursor paging correctness under concurrent rescans — cache
  invalidation on rescan (per above) keeps a session consistent within a
  snapshot.
- **Out of scope:** the client tree virtualization + lazy expansion UI (IG-33 for
  virtualization, IG-34 for on-demand fetch); graph aggregation (IG-31).

## Governance

- Claim the real IG id in the vault Roadmap before coding; commit with that
  prefix; no `Co-Authored-By: Claude` trailer.
- No frozen-contract change (additive endpoint; `/tree` preserved).
- Definition of done per epic README (note 09): passing Pest tests, strict types,
  no dead code; any UI added later carries four UI states + design tokens.
