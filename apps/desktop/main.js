'use strict';

/**
 * LSS Desktop – Electron main process (v0)
 *
 * Starts a local HTTP server (server.js) that serves apps/web/dist and
 * proxies /api/* to the Laravel API, then opens a BrowserWindow.
 *
 * DSK-7: wires preload.js + ipcMain handler for native folder picker.
 *
 * PLT-14: when launched WITHOUT a pre-provisioned LSS_API_TOKEN (i.e. not via
 * desktop.bat — the portable-exe path), main.js owns the whole local-Postgres
 * lifecycle itself: first-run/settings UI (db-setup.html), encrypted config
 * storage (db-config.js), migrating, and spawning the `php artisan serve`
 * sidecar with the user's own DB credentials injected into ONLY that child
 * process's environment (api-process.js) — never written to any .env file.
 * Launches via desktop.bat (LSS_API_TOKEN already set) are unaffected: this
 * file just proxies to the already-running, already-configured API exactly
 * as before ("legacy mode" below).
 */

const { app, BrowserWindow, ipcMain, shell, Menu, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createServer } = require('./server');
const dbConfig = require('./db-config');
const apiProcess = require('./api-process');

// ── Configuration ─────────────────────────────────────────────────────────────
const API_HOST = '127.0.0.1';
const API_PORT = 8000;
const DIST_DIR = path.resolve(__dirname, '..', 'web', 'dist');
const DB_SETUP_HTML = path.join(__dirname, 'db-setup.html');
const SELF_CONTAINED_API_URL = 'http://' + API_HOST + ':' + API_PORT;

// Legacy mode: desktop.bat (or another external launcher) already migrated,
// started the API and provisioned LSS_API_TOKEN — main.js must not touch DB
// config or spawn a second API process. This is unchanged v0/DSK-3 behaviour.
const LEGACY_MODE = Boolean(process.env.LSS_API_TOKEN);
const LEGACY_API_URL = process.env.LSS_API_URL || SELF_CONTAINED_API_URL;

// ── Single-instance lock ───────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

// ── Window / process state ─────────────────────────────────────────────────────
let mainWindow = null;
let appPort = null; // port the local static/proxy server (server.js) is listening on
let apiChild = null; // ChildProcess we spawned ourselves (self-contained mode only)
let localLinkToken = process.env.LSS_LOCAL_LINK_TOKEN || null;

/** Fail fast when index.html references a missing hashed bundle (classic white-screen cause). */
function verifyDist(distDir) {
  const indexPath = path.join(distDir, 'index.html');
  if (!fs.existsSync(indexPath)) {
    return {
      ok: false,
      message:
        'apps/web/dist/index.html is missing.\n\nRun: cd apps/web && npm run build',
    };
  }

  const html = fs.readFileSync(indexPath, 'utf8');
  const match = html.match(/src="(\/assets\/[^"]+\.js)"/);
  if (!match) {
    return { ok: false, message: 'dist/index.html has no entry script tag.' };
  }

  const rel = match[1].replace(/^\//, '').split('/').join(path.sep);
  const bundlePath = path.join(distDir, rel);
  if (!fs.existsSync(bundlePath)) {
    return {
      ok: false,
      message:
        'dist is out of sync — ' + match[1] + ' is missing.\n\nRun: cd apps/web && npm run build',
    };
  }

  return { ok: true };
}

function attachWindowDiagnostics(win) {
  win.webContents.on('did-fail-load', (_event, code, description, url) => {
    if (code === -3) return; // ERR_ABORTED during navigation — ignore
    dialog.showErrorBox(
      'LSS failed to load',
      'Could not load the UI (' + code + '):\n' + description + '\n\nURL: ' + url +
      '\n\nTry rebuilding the web app: cd apps/web && npm run build',
    );
  });

  win.webContents.on('render-process-gone', (_event, details) => {
    dialog.showErrorBox(
      'LSS renderer crashed',
      'The UI process exited unexpectedly (' + details.reason + '). ' +
      'If this repeats on Explore, update and rebuild — heavy graph views are lazy-loaded.',
    );
  });
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width : 1280,
    height: 800,
    title : 'LSS Maintenance System',
    webPreferences: {
      contextIsolation : true,
      nodeIntegration  : false,
      sandbox          : false,  // must be false to allow preload IPC
      preload          : path.join(__dirname, 'preload.js'),
    },
  });

  // Block new windows opened by the renderer (window.open, target="_blank")
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://127.0.0.1:' + port)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Block navigation away from the local server origin
  mainWindow.webContents.on('will-navigate', (event, navUrl) => {
    if (!navUrl.startsWith('http://127.0.0.1:' + port)) {
      event.preventDefault();
      shell.openExternal(navUrl);
    }
  });

  attachWindowDiagnostics(mainWindow);

  mainWindow.on('closed', () => { mainWindow = null; });
}

/** Navigates the main window to the built web app (via server.js's proxy). */
function loadApp() {
  mainWindow.loadURL('http://127.0.0.1:' + appPort);
}

/** Navigates the main window to the Database settings page (PLT-14). */
function loadDbSetup(errorMessage) {
  const options = errorMessage ? { query: { error: encodeURIComponent(errorMessage) } } : undefined;
  mainWindow.loadFile(DB_SETUP_HTML, options);
}

function killApiChild() {
  if (apiChild && !apiChild.killed) {
    try { apiChild.kill(); } catch (_err) { /* already gone */ }
  }
  apiChild = null;
}

/**
 * Migrates against `cfg`, then (re)spawns the `php artisan serve` sidecar
 * bound to 127.0.0.1:8000 with `cfg`'s DB_* env injected, waits for
 * /api/v1/health, and issues a fresh desktop Sanctum token the same way
 * desktop.bat does (IssueDesktopToken / DSK-3).
 * Resolves { ok: true } or { ok: false, message }.
 */
async function startSelfContainedApi(cfg) {
  localLinkToken = localLinkToken || crypto.randomUUID();
  const extraEnv = Object.assign({}, apiProcess.buildDbEnv(cfg), { LSS_LOCAL_LINK_TOKEN: localLinkToken });

  // Create-if-missing → migrate --force → boot sidecar. Portable-exe users
  // never need to open a Postgres client themselves.
  const ensured = await apiProcess.ensureDatabaseExists(cfg);
  if (!ensured.ok) {
    return { ok: false, message: ensured.message };
  }

  const migrate = await apiProcess.runArtisan(['migrate', '--force', '--no-ansi'], extraEnv, 30000);
  if (migrate.code !== 0) {
    return { ok: false, message: apiProcess.interpretDbError(migrate.stderr + '\n' + migrate.stdout) };
  }

  killApiChild();
  const spawned = apiProcess.spawnApiServer(API_HOST, API_PORT, extraEnv);
  apiChild = spawned;
  spawned.on('exit', (code) => {
    // Ignore exits from a child we've already superseded (deliberate restart).
    if (apiChild !== spawned) return;
    if (code !== 0 && code !== null) {
      dialog.showErrorBox(
        'LSS API stopped',
        'The local API process exited unexpectedly (code ' + code + '). Restart the application.',
      );
    }
  });

  const healthy = await apiProcess.waitForHealth(SELF_CONTAINED_API_URL + '/api/v1/health', 20000);
  if (!healthy) {
    return { ok: false, message: 'The API process started but did not become healthy within 20s. Check apps/api logs.' };
  }

  const tokenResult = await apiProcess.runArtisan(['desktop:token'], extraEnv, 15000);
  const plainToken = tokenResult.stdout.trim().split('\n').filter(Boolean).pop();
  if (tokenResult.code === 0 && plainToken) {
    process.env.LSS_API_TOKEN = plainToken;
  }
  process.env.LSS_LOCAL_LINK_TOKEN = localLinkToken;

  return { ok: true };
}

/** Merges a renderer-typed candidate with the stored config's password as a fallback. */
function resolveCandidate(candidate) {
  const stored = dbConfig.loadConfig();
  const c = candidate || {};
  return {
    host: (c.host || '').trim() || dbConfig.DEFAULTS.host,
    port: Number(c.port) || dbConfig.DEFAULTS.port,
    database: (c.database || '').trim() || dbConfig.DEFAULTS.database,
    username: (c.username || '').trim() || dbConfig.DEFAULTS.username,
    password: c.password ? c.password : stored.password,
  };
}

// ── IPC handlers (registered unconditionally, before app is necessarily ready) ─

// DSK-7: native folder picker — exposed to renderer via preload.js
ipcMain.handle('lss:pick-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select project folder',
  });
  return result.canceled || result.filePaths.length === 0
    ? null
    : result.filePaths[0];
});

// PLT-14: Database settings page IPC — never returns a raw stored password.
ipcMain.handle('db:getStatus', () => dbConfig.maskConfig(dbConfig.loadConfig()));

ipcMain.handle('db:test', async (_event, candidate) => {
  const cfg = resolveCandidate(candidate);
  if (!apiProcess.isValidDatabaseName(cfg.database)) {
    return { ok: false, message: 'Database name may only contain letters, numbers, and underscores.' };
  }

  let result = await apiProcess.runArtisan(['migrate:status', '--no-ansi'], apiProcess.buildDbEnv(cfg), 15000);
  if (result.code === 0) return { ok: true };

  const combined = result.stderr + '\n' + result.stdout;
  if (!apiProcess.isMissingDatabaseError(combined)) {
    return { ok: false, message: apiProcess.interpretDbError(combined) };
  }

  // Missing database is recoverable without a Postgres client: create it,
  // then re-test so the user gets a genuine "connected" result rather than
  // a confusing "does not exist" dead end.
  const ensured = await apiProcess.ensureDatabaseExists(cfg);
  if (!ensured.ok) {
    return { ok: false, message: ensured.message };
  }

  result = await apiProcess.runArtisan(['migrate:status', '--no-ansi'], apiProcess.buildDbEnv(cfg), 15000);
  if (result.code === 0) {
    return { ok: true, message: 'Database "' + cfg.database + '" did not exist, so it was created. Connection OK.' };
  }
  return { ok: false, message: apiProcess.interpretDbError(result.stderr + '\n' + result.stdout) };
});

ipcMain.handle('db:save', async (_event, candidate) => {
  const cfg = resolveCandidate(candidate);
  if (!apiProcess.isValidDatabaseName(cfg.database)) {
    return { ok: false, message: 'Database name may only contain letters, numbers, and underscores.' };
  }

  dbConfig.saveConfig(cfg);
  const result = await startSelfContainedApi(cfg);
  if (result.ok && mainWindow) {
    loadApp();
  }
  return result;
});

// ── App menu ────────────────────────────────────────────────────────────────
function buildMenu() {
  const template = [
    {
      label: 'LSS',
      submenu: [
        {
          label: 'Database settings…',
          enabled: !LEGACY_MODE,
          click: () => { if (mainWindow) loadDbSetup(null); },
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  buildMenu();

  const distCheck = verifyDist(DIST_DIR);
  if (!distCheck.ok) {
    dialog.showErrorBox('LSS startup error', distCheck.message);
    app.quit();
    return;
  }

  const apiUrlForProxy = LEGACY_MODE ? LEGACY_API_URL : SELF_CONTAINED_API_URL;

  let port;
  try {
    const srv = await createServer(DIST_DIR, apiUrlForProxy);
    port = srv.port;
    appPort = port;
  } catch (err) {
    dialog.showErrorBox(
      'LSS startup error',
      'Could not start the file server:\n\n' + err.message +
      '\n\nMake sure you have run `npm run build` in apps/web first.'
    );
    app.quit();
    return;
  }

  createWindow(port);

  if (LEGACY_MODE) {
    // desktop.bat (or another external launcher) already migrated, started
    // the API and issued the token — behave exactly like v0.
    loadApp();
    return;
  }

  // Self-contained path (portable-exe / direct launch): try the saved (or
  // default 127.0.0.1:5432 lss/lss/lss) config before bothering the user.
  const cfg = dbConfig.loadConfig();
  const probe = await apiProcess.runArtisan(['migrate:status', '--no-ansi'], apiProcess.buildDbEnv(cfg), 15000);

  if (probe.code === 0) {
    const result = await startSelfContainedApi(cfg);
    if (result.ok) {
      loadApp();
      return;
    }
    loadDbSetup(result.message);
    return;
  }

  loadDbSetup(apiProcess.interpretDbError(probe.stderr + '\n' + probe.stdout));
});

// Bring existing window to front when a second instance is launched
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// Standard macOS behaviour: re-create window on activate if none exist
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && mainWindow === null) {
    // Port is not available here; user should restart the app.
  }
});

// Quit when all windows are closed (Windows/Linux behaviour)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// PLT-14: never leave an orphaned PHP sidecar running after the app quits.
app.on('will-quit', () => {
  killApiChild();
});
