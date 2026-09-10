# IG-32 — Archify-exact Map demo

Explore Map renders **live** `GET /graph/rollup` as Archify architecture HTML
(Signal Flow cards + routes), not hub-dot circles. Drill uses
`GET /graph/neighbourhood` on the same Map. Present and 1200×630 share come
from the vendored Archify viewer (`packages/archify`, MIT, tt-a1i/archify).

## Run locally

1. API: `cd apps/api` then `php artisan serve` → http://127.0.0.1:8000  
   Health: `/api/v1/health`
2. Web: `cd apps/web` then `npm run dev`
3. Settings: paste a bearer token. Open a project that already has a graph snapshot.
4. Explore → **Map**

## Screenshot / review steps

1. **Overview** — rounded folder cards, clean routes, Archify chrome. DevTools:
   Map mount is `GET /projects/:id/graph/rollup?depth=1` only. No `GET /graph`.
2. **Progressive depth** — Archify MAP / READ / FULL on the viewer (sublabels
   then tags). Click a folder card: neighbourhood files replace the overview
   as cards (Back restores folders). Still no `GET /graph`.
3. **Present** — press **F** or open `/explore?present=1`. LSS nav + node tree
   hide; Archify presentation stage fills the viewport. Escape / F again exits.
4. **Share** — Map **Share** (or Archify Export → share card) writes a
   **1200×630 PNG**.

## Fixture HTML (no API)

From repo root:

```
node packages/archify/scripts/smoke-render.mjs
```

Folder cards sit on **left-to-right signal-flow layers** from payload
edges (sources left, sinks right). Isolates park on the right. No invented
routes.

The smoke script delivers an eight-folder signal-flow artifact through the
same renderer the Map uses (`layoutOk`, rounded `rx="6"` cards, Present,
share-card) and writes `demo-out/archify-exact-map.html` (open in a browser;
F for Present).
