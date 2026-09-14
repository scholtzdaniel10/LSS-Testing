# @lss/archify

Architecture-only subset of [tt-a1i/archify](https://github.com/tt-a1i/archify) (MIT),
vendored so Explore Map can render live `GET /graph/rollup` (and neighbourhood
on drill) as Archify architecture HTML.

## Attribution

Copyright (c) 2026 tt-a1i (Archify) and Cocoon AI. See `LICENSE` and
`vendor/LICENSE`. JetBrains Mono in `vendor/assets/template.html` is SIL OFL
(see `vendor/assets/JetBrainsMono-OFL.txt`).

This package ships the architecture renderer, shared geometry, template viewer
(Present, MAP/READ/FULL, 1200×630 share card), and schemas. Workflow / sequence /
dataflow / lifecycle renderers, brand-mark capture, and Node CLI `deliver` are
not included.

## Refresh

Clone https://github.com/tt-a1i/archify and run:

```
node packages/archify/scripts/bootstrap-vendor.mjs <path-to-archify-clone>
```

Then restore the browser-safe `vendor/renderers/shared/{cli,diagnostics,brand-marks}.mjs`
shims if the script is re-run (it does not overwrite those three files).
