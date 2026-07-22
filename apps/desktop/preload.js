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
 *     The Sanctum bearer token auto-issued by desktop.bat, or null when
 *     running outside the desktop launcher (e.g. browser dev).
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lssDesktop', {
  /** @returns {Promise<string | null>} */
  pickFolder: () => ipcRenderer.invoke('lss:pick-folder'),

  /** @type {string | null} */
  apiToken: process.env.LSS_API_TOKEN ?? null,
});
