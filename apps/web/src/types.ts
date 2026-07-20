export type DimensionKey = 'errors' | 'dependencies' | 'tests' | 'structure';

export interface DimensionScore {
  key: DimensionKey;
  label: string;
  score: number;
  delta: number;
  detail: string;
  trend: number[];
}

export type EditorPreset = 'vscode' | 'phpstorm' | 'sublime' | 'custom';

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

/** IG-15: open a file:line in the configured IDE. Returns false when localRoot is unset. */
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

  let href = '';
  switch (settings.editor) {
    case 'vscode':
      href = `vscode://file/${absolute}:${line}`;
      break;
    case 'phpstorm':
      href = `phpstorm://open?file=${encodeURIComponent(absolute.replace(/\//g, '\\'))}&line=${line}`;
      break;
    case 'sublime':
      href = `subl://open/?url=file://${encodeURIComponent(absolute)}&line=${line}`;
      break;
    case 'custom':
      href = settings.customTemplate
        .replaceAll('{path}', absolute)
        .replaceAll('{line}', String(line));
      break;
  }
  if (href) window.location.href = href;
  return true;
}
