/**
 * DSK-7: type declaration for the lssDesktop bridge exposed by the Electron
 * preload script via contextBridge.exposeInMainWorld('lssDesktop', ...).
 * Only present when running inside the desktop wrapper.
 */
interface LssDesktop {
  /** Opens a native folder-picker dialog. Returns the selected path, or null on cancel. */
  pickFolder: () => Promise<string | null>;
}

interface Window {
  lssDesktop?: LssDesktop;
}
