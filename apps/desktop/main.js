'use strict';

/**
 * LSS Desktop – Electron main process (v0)
 *
 * Starts a local HTTP server (server.js) that serves apps/web/dist
 * and proxies /api/* to the Laravel API, then opens a BrowserWindow.
 */

const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const { createServer } = require('./server');

// ── Configuration ─────────────────────────────────────────────────────────────
const API_URL  = process.env.LSS_API_URL || 'http://127.0.0.1:8000';
const DIST_DIR = path.resolve(__dirname, '..', 'web', 'dist');

// ── Single-instance lock ───────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

// ── Window management ─────────────────────────────────────────────────────────
let mainWindow = null;

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width : 1280,
    height: 800,
    title : 'LSS Maintenance System',
    webPreferences: {
      contextIsolation : true,
      nodeIntegration  : false,
      sandbox          : true,
    },
  });

  // Block new windows opened by the renderer (window.open, target="_blank")
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Open external links in the default system browser
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

  mainWindow.loadURL('http://127.0.0.1:' + port);

  mainWindow.on('closed', () => { mainWindow = null; });
}

// Bring existing window to front when a second instance is launched
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  let port;
  try {
    const srv = await createServer(DIST_DIR, API_URL);
    port = srv.port;
  } catch (err) {
    // If the server itself fails (e.g. dist missing), show an error dialog and quit
    const { dialog } = require('electron');
    dialog.showErrorBox(
      'LSS – startup error',
      'Could not start the file server:\n\n' + err.message +
      '\n\nMake sure you have run `npm run build` in apps/web first.'
    );
    app.quit();
    return;
  }

  createWindow(port);
});

// Standard macOS behaviour: re-create window on activate if none exist
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && mainWindow === null) {
    // We don't have the port here; user should restart.
    // For v0 this edge case is macOS-only and acceptable.
  }
});

// Quit when all windows are closed (Windows/Linux behaviour)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
