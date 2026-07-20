import { emptyIgnoreStats, recordSkip, shouldIgnorePath, type IgnoreStats } from './ignoreRules';

export type LocalFileEntry = {
  path: string;
  size: number;
  /** Present after read; omitted for very large trees until upload. */
  content?: ArrayBuffer;
};

export type LocalProjectManifest = {
  id: string;
  name: string;
  droppedAt: string;
  files: LocalFileEntry[];
  stats: IgnoreStats;
  serverProjectId?: string;
  uploadJobId?: string;
};

const DB_NAME = 'lss-maintain';
const DB_VERSION = 1;
const STORE = 'projects';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveLocalProject(manifest: LocalProjectManifest): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(manifest);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadLocalProject(id: string): Promise<LocalProjectManifest | null> {
  const db = await openDb();
  const result = await new Promise<LocalProjectManifest | null>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve((req.result as LocalProjectManifest) ?? null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return result;
}

export async function listLocalProjects(): Promise<LocalProjectManifest[]> {
  const db = await openDb();
  const result = await new Promise<LocalProjectManifest[]>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve((req.result as LocalProjectManifest[]) ?? []);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return result;
}

/** Strip the folder-name prefix webkitdirectory adds (handles nested same-name folders). */
function stripPickerPrefix(relative: string, folderName: string): string {
  let path = relative.replace(/\\/g, '/');
  while (path.startsWith(`${folderName}/`)) {
    path = path.slice(folderName.length + 1);
  }
  return path;
}

/** Walk a dropped FileList / webkitdirectory listing with ignore rules (IG-17/18). */
export async function ingestFileList(
  fileList: FileList | File[],
  nameHint: string,
): Promise<LocalProjectManifest> {
  const stats = emptyIgnoreStats();
  const files: LocalFileEntry[] = [];
  const list = Array.from(fileList);

  const top = list[0]?.webkitRelativePath?.split(/[/\\]/)[0] ?? nameHint;

  for (const file of list) {
    const relative = (file.webkitRelativePath || file.name).replace(/\\/g, '/');
    const path = stripPickerPrefix(relative, top);
    const rule = shouldIgnorePath(path);
    if (rule) {
      recordSkip(stats, rule);
      continue;
    }
    stats.kept += 1;
    // Store metadata first for fast tree; content for files under 1.5MB for offline preview.
    const entry: LocalFileEntry = { path, size: file.size };
    if (file.size <= 1_500_000) {
      entry.content = await file.arrayBuffer();
    }
    files.push(entry);
  }

  const top = list[0]?.webkitRelativePath?.split(/[/\\]/)[0];
  return {
    id: crypto.randomUUID(),
    name: nameHint || top || 'imported-program',
    droppedAt: new Date().toISOString(),
    files,
    stats,
  };
}

/**
 * Read a directory handle (File System Access API) recursively with ignore rules.
 */
export async function ingestDirectoryHandle(
  handle: FileSystemDirectoryHandle,
  nameHint?: string,
): Promise<LocalProjectManifest> {
  const stats = emptyIgnoreStats();
  const files: LocalFileEntry[] = [];

  async function walk(dir: FileSystemDirectoryHandle, prefix: string): Promise<void> {
    for await (const [name, entry] of dir.entries()) {
      const path = prefix ? `${prefix}/${name}` : name;
      if (entry.kind === 'directory') {
        const rule = shouldIgnorePath(path);
        if (rule) {
          // Count the directory itself as skipped; do not descend.
          recordSkip(stats, rule);
          continue;
        }
        await walk(entry, path);
      } else {
        const rule = shouldIgnorePath(path);
        if (rule) {
          recordSkip(stats, rule);
          continue;
        }
        stats.kept += 1;
        const file = await entry.getFile();
        const item: LocalFileEntry = { path, size: file.size };
        if (file.size <= 1_500_000) {
          item.content = await file.arrayBuffer();
        }
        files.push(item);
      }
    }
  }

  await walk(handle, '');
  return {
    id: crypto.randomUUID(),
    name: nameHint || handle.name || 'imported-program',
    droppedAt: new Date().toISOString(),
    files,
    stats,
  };
}
