/**
 * DSK-7: type declaration for the lssDesktop bridge exposed by the Electron
 * preload script via contextBridge.exposeInMainWorld('lssDesktop', ...).
 * Only present when running inside the desktop wrapper.
 */
interface LssDesktop {
  /** Opens a native folder-picker dialog. Returns the selected path, or null on cancel. */
  pickFolder: () => Promise<string | null>;

  /**
   * DSK-3: Sanctum bearer token auto-issued by desktop.bat for the
   * desktop@lss.local user.  Non-null only when launched via desktop.bat.
   * The web app adopts this token at boot, overwriting any stored token.
   */
  apiToken: string | null;
}

interface Window {
  lssDesktop?: LssDesktop;
}
