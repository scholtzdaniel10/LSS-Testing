export type DimensionKey = 'errors' | 'dependencies' | 'tests' | 'structure';

export interface DimensionScore {
  key: DimensionKey;
  label: string;
  score: number;
  delta: number;
  detail: string;
  trend: number[];
}

export type EditorPreset = 'vscode' | 'cursor' | 'phpstorm' | 'sublime' | 'custom';

export type EditorSettings = {
  editor: EditorPreset;
  customTemplate: string;
  localRoot: string;
};

const EDITOR_KEY = 'lss.editorSettings';

export const defaultEditorSettings = (): EditorSettings => ({
  editor: 'vscode',
  customTemplate: '',
  localRoot: '',
});

export function loadEditorSettings(): EditorSettings {
  try {
    const raw = localStorage.getItem(EDITOR_KEY);
    if (!raw) return defaultEditorSettings();
    return { ...defaultEditorSettings(), ...JSON.parse(raw) };
  } catch {
    return defaultEditorSettings();
  }
}

export function saveEditorSettings(settings: EditorSettings): void {
  localStorage.setItem(EDITOR_KEY, JSON.stringify(settings));
}

/** Persist the on-disk project folder (shared by Explore link + IDE open). */
export function saveLocalProjectRoot(path: string): void {
  saveEditorSettings({ ...loadEditorSettings(), localRoot: path });
}

export function loadLocalProjectRoot(): string {
  return loadEditorSettings().localRoot.trim();
}

/**
 * Fire a desktop-protocol URI (vscode://, cursor://, …) without navigating the
 * page away. A hidden iframe lets several launches queue in sequence — needed
 * when we open the project folder and then reveal a file inside it.
 */
function launchUri(uri: string): void {
  if (!uri) return;
  const frame = document.createElement('iframe');
  frame.style.display = 'none';
  frame.src = uri;
  document.body.appendChild(frame);
  window.setTimeout(() => frame.remove(), 1500);
}

/**
 * IG-15: open a file:line in the configured IDE. Returns false when localRoot
 * is unset. VS Code and Cursor also open the whole project folder as the
 * workspace first, so the file is revealed inside the project tree rather than
 * on its own — see openInIde's folder step.
 */
export function openInIde(settings: EditorSettings, filePath: string, line = 1, projectName?: string): boolean {
  if (!settings.localRoot.trim()) {
    return false;
  }

  const root = settings.localRoot.replace(/\\/g, '/').replace(/\/$/, '');
  let rel = filePath.replace(/\\/g, '/').replace(/^\//, '');

  // Avoid …/LSS-Testing/LSS-Testing/README when localRoot already ends with LSS-Testing.
  const rootLeaf = root.split('/').pop() ?? '';
  const nameLeaf = projectName?.replace(/\\/g, '/').replace(/\/$/, '').split('/').pop() ?? '';
  for (const leaf of [rootLeaf, nameLeaf]) {
    if (leaf && rel.startsWith(`${leaf}/`)) {
      rel = rel.slice(leaf.length + 1);
      break;
    }
  }

  const absolute = `${root}/${rel}`;

  switch (settings.editor) {
    case 'vscode':
    case 'cursor': {
      // vscode:// and cursor:// share the same URI scheme. A path that is a
      // directory opens it as the workspace folder; a file path opens/reveals
      // that file. Open the folder first, then the file a beat later so the
      // editor has the project tree loaded before revealing the file.
      const scheme = settings.editor;
      launchUri(`${scheme}://file/${root}`);
      window.setTimeout(() => launchUri(`${scheme}://file/${absolute}:${line}`), 600);
      break;
    }
    case 'phpstorm':
      // PhpStorm reveals the file inside whichever project already contains it.
      launchUri(`phpstorm://open?file=${encodeURIComponent(absolute.replace(/\//g, '\\'))}&line=${line}`);
      break;
    case 'sublime':
      launchUri(`subl://open/?url=file://${encodeURIComponent(absolute)}&line=${line}`);
      break;
    case 'custom':
      launchUri(
        settings.customTemplate
          .replaceAll('{root}', root)
          .replaceAll('{path}', absolute)
          .replaceAll('{line}', String(line)),
      );
      break;
  }
  return true;
}
