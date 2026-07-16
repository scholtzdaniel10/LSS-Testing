# @lss/renderer

Pure node-tree → DOM renderer, shared by the builder's live preview and the
Playwright test runner. Lands with task **NT-11** (vault note
`02 Feature — Node-Tree DEV Environment`, milestone NT-M4).

Contract obligations when implementing:
- Pure function of the scene (C1) + node-type registry (C2) — no app state.
- Stamps `data-testid="{node.id}"` on every rendered node (C6 bridge rule —
  load-bearing for right-click test fabrication; do not remove).
