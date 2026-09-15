# LSS Maintenance System – Desktop (Electron)

Wraps the built Ionic/React web app in an Electron window with a local HTTP
server that also proxies `/api/*` to the Laravel backend.  No changes to web
source are needed.

## Prerequisites

- Node.js 18+ on your machine
- The Laravel API running: `cd apps/api && php artisan serve` (→ http://127.0.0.1:8000)
- The web app built: `cd apps/web && npm run build`

## One-click launch (Windows)

Two launchers live at the repo root. Both install Electron deps on first run,
build the web app, migrate the database, start the Laravel API in a separate
cmd window if it is not already running, start a **queue worker**
(`php artisan queue:listen --tries=1 --timeout=660`) in its own window if none
is running, then launch Electron.

| Launcher | Auth | Env it sets |
|---|---|---|
| `desktop.bat` | **Auto-token**: runs `php artisan desktop:token`, injects `LSS_API_TOKEN`; opens already signed in as `desktop@lss.local`. | `LSS_API_TOKEN`, `LSS_LOCAL_LINK_TOKEN` |
| `desktop-login.bat` | **Login**: issues no token; Electron lands on `/login` and the user signs in with email + password (DX-auth). | `LSS_EXTERNAL_API=1`, `LSS_LOCAL_LINK_TOKEN` |

The queue worker matters: Link / analyze jobs are dispatched to the queue and
sit at "queued 0%" until a worker picks them up. Electron only spawns its own
worker in the self-contained path (below), so the `.bat` launchers do it.

For `desktop-login.bat` sign in with a seeded user (`php artisan db:seed` creates
`daniel@lss.local` / `jean@lss.local`, password `password`).

## Quick start

```sh
# 1. Install Electron (one-time)
cd apps/desktop
npm install

# 2. Build the web app (from repo root or apps/web)
npm --prefix apps/web run build

# 3. Launch (self-contained: migrates Postgres, spawns API + queue:listen on :8000)
npm --prefix apps/desktop start
# or from apps/desktop:
npm start
```

When launched **without** `LSS_API_TOKEN` (portable exe / `npm start` directly),
Electron owns the Laravel API **and** a `php artisan queue:listen --timeout=660`
worker with the same injected `DB_*`, `SESSION_DRIVER=file`, and `CACHE_STORE=file`
env. Both processes are killed on app quit.

**Legacy / external-API mode** is entered when *either* `LSS_API_TOKEN` is set
(`desktop.bat`) *or* `LSS_EXTERNAL_API=1` is set (`desktop-login.bat`). Electron
only proxies to the already-running API at `LSS_API_URL` (default
`http://127.0.0.1:8000`): it does not touch DB config, spawn API/queue sidecars,
or run `desktop:token`. With `LSS_EXTERNAL_API=1` and no token,
`window.lssDesktop.apiToken` is `null` and the web app shows `/login`. If you
start the API by hand instead of via a `.bat`, run
`php artisan queue:listen --timeout=660` in a separate terminal yourself.

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

Requires [electron-builder](https://www.electron.build/) (included as a
devDependency) and must be run on Windows:

```powershell
# Close any running "LSS Maintenance System" / Electron windows first
# (otherwise app.asar is locked and the build fails).

cd C:\LSS\LSS-Testing\apps\web
npm run build

cd C:\LSS\LSS-Testing\apps\desktop
npm install
npm run dist
```

Signing is **disabled** for local builds (`signAndEditExecutable: false` +
`CSC_IDENTITY_AUTO_DISCOVERY=false`) so Windows does not need Developer Mode /
symlink privileges for the unused macOS bits inside `winCodeSign`.

Outputs to `apps/desktop/dist-electron/`:
- `LSS Maintenance System x.x.x.exe` — portable single-file exe
- `LSS Maintenance System Setup x.x.x.exe` — NSIS installer

If you see `app.asar: … being used by another process`, quit the app (and any
leftover `electron.exe`), delete `dist-electron\win-unpacked` if needed, then
re-run `npm run dist`.

Ignore `EBADPLATFORM` / `@esbuild/linux-x64` during `npm install` on Windows —
that optional dependency is for Linux CI; the web build still succeeds.

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

### Per-launch session token and auto-provisioning (DSK-3)

`desktop.bat` now does four things automatically before launching Electron:

1. **Generates `LSS_LOCAL_LINK_TOKEN`** — a fresh GUID on every launch via
   PowerShell.  Both the API process and the Electron proxy inherit it; the
   `RequireLocalLinkToken` middleware rejects any local-folder-linking request
   that does not carry the matching `X-LSS-Local-Token` header.

2. **Runs `php artisan migrate --force`** — ensures the SQLite (or Postgres)
   schema is up to date before any API requests are made.

3. **Issues the Sanctum API token** — runs `php artisan desktop:token`, which
   find-or-creates `desktop@lss.local`, deletes any leftover tokens labelled
   `desktop` from previous launches, and creates a fresh one.  The plain token
   is captured into the `LSS_API_TOKEN` environment variable; Electron inherits
   it and `preload.js` exposes it to the renderer as `window.lssDesktop.apiToken`.

4. **Web app adopts the token at boot** — `ProjectContext.tsx` reads
   `window.lssDesktop?.apiToken` at module-load time and calls `setApiToken()`
   before any React state is initialised, so every API request is authenticated
   from the first render.  SettingsPage shows a hint when the desktop token is
   active; manual entry remains possible for overrides.

The practical effect: a user can double-click `desktop.bat` and the app is
immediately usable — no `db:seed`, no `token:issue`, no Settings paste needed.

**Dev note:** running `php artisan serve` manually (without `desktop.bat`) leaves
both env vars unset. `LSS_LOCAL_LINK_TOKEN` absent disables the local-link
enforcement; `LSS_API_TOKEN` absent means the web app falls back to any token
stored in `localStorage` — the same behaviour as before. Browser dev workflow
is unchanged; `php artisan token:issue <email>` is still used there.
