# LSS Maintenance System – Desktop (Electron)

Wraps the built Ionic/React web app in an Electron window with a local HTTP
server that also proxies `/api/*` to the Laravel backend.  No changes to web
source are needed.

## Prerequisites

- Node.js 18+ on your machine
- The Laravel API running: `cd apps/api && php artisan serve` (→ http://127.0.0.1:8000)
- The web app built: `cd apps/web && npm run build`

## One-click launch (Windows)

Run `desktop.bat` from the repo root (double-click it in Explorer or call it
from cmd). It installs Electron deps on first run, builds the web app, starts
the Laravel API in a separate cmd window if it is not already running, then
launches the Electron desktop app — all in one step.

## Quick start

```sh
# 1. Install Electron (one-time)
cd apps/desktop
npm install

# 2. Build the web app (from repo root or apps/web)
npm --prefix apps/web run build

# 3. Launch
npm --prefix apps/desktop start
# or from apps/desktop:
npm start
```

## API URL override

By default the embedded proxy forwards `/api/*` to `http://127.0.0.1:8000`.
Override with the `LSS_API_URL` environment variable:

```sh
LSS_API_URL=http://192.168.1.10:8000 npm start
```

On Windows (cmd):
```bat
set LSS_API_URL=http://192.168.1.10:8000 && npm start
```

## Building a distributable installer (Windows)

Requires [electron-builder](https://www.electron.build/) (included as devDependency)
and must be run on Windows:

```sh
cd apps/desktop
npm install
npm run dist
```

Outputs to `apps/desktop/dist-electron/`:
- `LSS Maintenance System Setup x.x.x.exe` — NSIS installer
- `LSS Maintenance System x.x.x.exe` — portable single-file exe

## How it works

`server.js` starts a plain Node `http.Server` bound to `127.0.0.1` on a random
free port.  It serves `apps/web/dist` as static files with correct MIME types
and falls back to `index.html` for any unknown path (SPA routing).  Any request
whose path starts with `/api` is streamed through to the Laravel API; if the API
is unreachable the server returns HTTP 502 with a JSON error body and the web
app's existing error states handle it gracefully.

`main.js` is the Electron main process.  It enforces a single-instance lock,
starts `server.js`, opens a `BrowserWindow` pointing at the local server, and
opens any external links in the default system browser.

`preload.js` (DSK-7) exposes `window.lssDesktop.pickFolder()` to the renderer
via `contextBridge` with `contextIsolation: true` and `nodeIntegration: false`.
The picker opens a native OS folder-selection dialog; the result is returned to
the renderer as a plain string path (or `null` on cancel) via IPC.

## Linking a folder (production flow, DSK-7)

No `.env` edit is required to link a project folder any more. The wizard on
the Projects page walks the user through the whole flow:

1. Click **+ New project → Link folder on this machine**.
2. Click **Browse…** (or type a path). The button opens the native OS folder
   picker via `window.lssDesktop.pickFolder()`.
3. Click **Link folder**. If the folder is not yet under any consented root,
   the API rejects with a `422 { code: "path_not_allowed" }` problem. The web
   UI catches that specific code and shows an in-app consent card:
   *"Allow the engine to read everything under <folder>?"* — clicking
   **Allow** POSTs to `/api/v1/local-roots` and automatically retries the
   link. The folder is remembered on the server side; subsequent links under
   the same tree skip the consent step.
4. Registered roots can be reviewed and revoked in **Settings → Allowed
   folders**.

### Environment variables (ops / dev)

- `SANDBOX_ALLOW_LOCAL_LINK` (default: `true`) — master kill-switch. Set to
  `false` to block *all* local-folder linking on this API, regardless of
  registered roots or env prefixes.
- `LOCAL_PATH_PREFIXES` — optional colon/semicolon-separated list of
  additional allowed root prefixes for dev/ops overrides. Merged with the
  DB-consented roots; end users don't need this.

### Per-launch session token (DSK-3)

`desktop.bat` generates a fresh random token (`LSS_LOCAL_LINK_TOKEN`) on every
launch using PowerShell's `[guid]::NewGuid()`. The token flows into both the
API process (started by `desktop.bat` in its own cmd window) and the Electron
proxy server via the inherited environment — no manual configuration is needed.

The `RequireLocalLinkToken` middleware in the API rejects any request to the
local-folder-linking surfaces (`/local-roots` and `/projects/{id}/link-local`)
that does not carry the matching value in the `X-LSS-Local-Token` header.
`server.js` injects this header automatically for all proxied `/api/*` requests
when the env var is set.

The practical effect: a page hosted outside this desktop session cannot trigger
local disk reads, even if it somehow reaches the API port. Each `desktop.bat`
launch issues a new token, so a captured token from a previous session is
immediately invalid.

**Dev note:** running `php artisan serve` manually (without `desktop.bat`) leaves
`LSS_LOCAL_LINK_TOKEN` unset, which disables enforcement entirely — the
middleware passes all requests through so local development keeps working without
any extra setup.
