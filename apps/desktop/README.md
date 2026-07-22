# LSS Maintenance System – Desktop (Electron)

Wraps the built Ionic/React web app in an Electron window with a local HTTP
server that also proxies `/api/*` to the Laravel backend.  No changes to web
source are needed.

## Prerequisites

- Node.js 18+ on your machine
- The Laravel API running: `cd apps/api && php artisan serve` (→ http://127.0.0.1:8000)
- The web app built: `cd apps/web && npm run build`

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
