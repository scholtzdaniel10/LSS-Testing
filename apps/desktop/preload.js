'use strict';

/**
 * DSK-7 – Electron preload script.
 *
 * Exposes a minimal, typed bridge to the renderer via contextBridge.
 * contextIsolation remains true; nodeIntegration remains false.
 *
 * API surface:
 *   window.lssDesktop.pickFolder() → Promise<string | null>
 *     Opens a native folder-picker dialog and resolves with the chosen path,
 *     or null if the user cancels.
 *
 *   window.lssDesktop.apiToken → string | null   (DSK-3)
 *     The Sanctum bearer token auto-issued by desktop.bat (or, in the
 *     self-contained launch path, by main.js itself — see PLT-14), or null
 *     when running outside the desktop launcher (e.g. browser dev).
 *
 *   window.lssDesktop.db  (PLT-14 — Database settings page only)
 *     getStatus() → Promise<{ host, port, database, username, hasPassword,
 *       isDefault, encrypted }>  — never the raw password.
 *     test(candidate) → Promise<{ ok: boolean, message?: string }>
 *       Runs `artisan migrate:status` against the candidate connection.
 *     save(candidate) → Promise<{ ok: boolean, message?: string }>
 *       Persists the config, migrates, and (re)starts the API sidecar.
 *     candidate shape: { host, port, database, username, password }. Typed
 *     values never leave this process except to main.js over IPC — the
 *     renderer never receives another window/tab's or a previously-saved
 *     credential back beyond what the operator just typed.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lssDesktop', {
  /** @returns {Promise<string | null>} */
  pickFolder: () => ipcRenderer.invoke('lss:pick-folder'),

  /** @type {string | null} */
  apiToken: process.env.LSS_API_TOKEN ?? null,

  db: {
    /** @returns {Promise<object>} masked config — see db-config.js maskConfig() */
    getStatus: () => ipcRenderer.invoke('db:getStatus'),
    /** @returns {Promise<{ok: boolean, message?: string}>} */
    test: (candidate) => ipcRenderer.invoke('db:test', candidate),
    /** @returns {Promise<{ok: boolean, message?: string}>} */
    save: (candidate) => ipcRenderer.invoke('db:save', candidate),
  },
});
