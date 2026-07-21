import { useCallback, useRef, useState } from 'react';
import { ApiError, api, getApiToken, pollJob, setActiveProjectId } from '../api/client';
import {
  ingestDirectoryHandle,
  ingestFileList,
  saveLocalProject,
  type LocalProjectManifest,
} from '../lib/localProjectStore';
import { zipLocalFiles } from '../lib/zipUpload';
import { linkLocalFolder } from '../lib/linkLocalProject';
import { loadLocalProjectRoot, saveLocalProjectRoot } from '../types';
import { useProject } from '../state/ProjectContext';

/**
 * Drop a folder for browser preview, then analyze on disk via API (no zip upload).
 */
const ImportDropzone: React.FC = () => {
  const { setLocalManifest, reloadAll, selectProject, token, project, localManifest } = useProject();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [statsLine, setStatsLine] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [diskPath, setDiskPath] = useState(loadLocalProjectRoot);
  const [showZipUpload, setShowZipUpload] = useState(false);

  const finishLocal = useCallback(async (manifest: LocalProjectManifest) => {
    await saveLocalProject(manifest);
    setLocalManifest(manifest);
    setStatsLine(
      `Kept ${manifest.stats.kept.toLocaleString()} · skipped ${manifest.stats.skipped.toLocaleString()} ` +
        `(${Object.entries(manifest.stats.skippedByRule)
          .map(([k, v]) => `${k}: ${v}`)
          .join(', ') || 'none'})`,
    );
    return manifest;
  }, [setLocalManifest]);

  const uniqueName = async (base: string): Promise<string> => {
    const { data: existing } = await api.projects();
    const names = new Set(existing.map((p) => p.name));
    if (!names.has(base)) return base;
    let i = 2;
    while (names.has(`${base}-${i}`)) i += 1;
    return `${base}-${i}`;
  };

  const persistDiskPath = (path: string) => {
    setDiskPath(path);
    saveLocalProjectRoot(path);
  };

  const linkLocal = async (manifest: LocalProjectManifest | null, localPath: string) => {
    const bearer = getApiToken() || token;
    if (!bearer) {
      setError('Set an API token in Settings before linking a local folder.');
      return;
    }
    const trimmed = localPath.trim();
    if (!trimmed) {
      setError('Enter the full folder path on your PC (e.g. C:\\Projects\\my-app).');
      return;
    }
    persistDiskPath(trimmed);
    try {
      const { projectId, name } = await linkLocalFolder(trimmed, {
        projectId: manifest?.serverProjectId ?? project?.id,
        projectName: manifest?.name ?? project?.name,
        token: bearer,
        onStatus: setBusy,
      });

      if (manifest) {
        const updated = { ...manifest, name, serverProjectId: projectId };
        await saveLocalProject(updated);
        setLocalManifest(updated);
      }
      setBusy('Link complete — switching to project…');
      selectProject(projectId);
      await reloadAll();
      setBusy(null);
      setError(null);
      setStatsLine(
        (prev) =>
          `${prev ?? ''} · Linked ${trimmed} on disk (no upload). Graph and diagnostics are from the API scan.`,
      );
    } catch (e) {
      const msg =
        e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Local link failed';
      setError(msg);
      setBusy(null);
    }
  };

  const upload = async (manifest: LocalProjectManifest) => {
    const bearer = getApiToken() || token;
    if (!bearer) {
      setError('Set an API token in Settings before uploading.');
      return;
    }
    try {
      setBusy('Zipping filtered sources…');
      const withContent = manifest.files.filter((f) => f.content && f.content.byteLength > 0);
      if (withContent.length === 0) {
        throw new Error('No file contents to upload (all ignored or empty). Try a smaller source folder.');
      }
      const blob = await zipLocalFiles(withContent, (done, total) => {
        setBusy(`Zipping ${done}/${total}…`);
      });

      const zipMb = blob.size / (1024 * 1024);
      if (zipMb > 1.9) {
        throw new Error(
          `Zip is ${zipMb.toFixed(1)} MB — use Analyze on disk instead (enter folder path above).`,
        );
      }

      setBusy('Creating project…');
      let projectId = manifest.serverProjectId;
      let name = manifest.name;
      if (!projectId) {
        name = await uniqueName(manifest.name);
        const created = await api.createProject(name);
        projectId = created.data.id;
      }
      setActiveProjectId(projectId);

      setBusy(`Uploading ${zipMb.toFixed(1)} MB (legacy zip import)…`);
      const imported = await api.importZip(projectId, blob, name, manifest.uploadJobId);
      if (imported.data.status === 'failed') {
        throw new Error(imported.meta?.message as string ?? 'Import failed on the server');
      }

      setBusy(`Import job ${imported.data.status}…`);
      const job = await pollJob(imported.data.jobId, (j) => {
        setBusy(`Import: ${j.status} ${j.progress}% — ${j.message ?? ''}`);
      }, 180_000);

      if (job.status === 'failed') {
        throw new Error(job.message ?? 'Import failed');
      }
      if (job.status !== 'done') {
        throw new Error(
          `Import stuck in "${job.status}". Set QUEUE_CONNECTION=sync in apps/api/.env or run php artisan queue:listen.`,
        );
      }

      const updated = {
        ...manifest,
        name,
        serverProjectId: projectId,
        uploadJobId: imported.data.jobId,
      };
      await saveLocalProject(updated);
      setLocalManifest(updated);
      selectProject(projectId);
      await reloadAll();
      setBusy(null);
      setError(null);
      setStatsLine((prev) => `${prev ?? ''} · Zip upload complete for ${name}.`);
    } catch (e) {
      const msg =
        e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Import failed';
      setError(msg);
      setBusy(null);
    }
  };

  const previewFolder = useCallback(async (files: FileList | null, nameHint?: string) => {
    if (!files || files.length === 0) return;
    setError(null);
    setBusy('Reading folder for preview…');
    try {
      const manifest = await ingestFileList(
        files,
        nameHint ?? files[0]?.webkitRelativePath?.split(/[/\\]/)[0] ?? 'program',
      );
      await finishLocal(manifest);
      setBusy(null);
      if (!diskPath.trim()) {
        setError(null);
        setStatsLine(
          (prev) =>
            `${prev ?? ''} · Preview ready — enter the same folder path below and click Analyze on disk.`,
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read folder');
      setBusy(null);
    }
  }, [diskPath, finishLocal]);

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setError(null);
    const items = e.dataTransfer.items;
    if (items?.[0] && 'getAsFileSystemHandle' in items[0]) {
      try {
        setBusy('Reading directory…');
        const handle = await (
          items[0] as DataTransferItem & { getAsFileSystemHandle: () => Promise<FileSystemHandle> }
        ).getAsFileSystemHandle();
        if (handle.kind === 'directory') {
          const manifest = await ingestDirectoryHandle(handle as FileSystemDirectoryHandle);
          await finishLocal(manifest);
          setBusy(null);
          return;
        }
      } catch {
        // fall through
      }
    }
    await previewFolder(e.dataTransfer.files);
  };

  const pickDirectory = async () => {
    if ('showDirectoryPicker' in window) {
      try {
        setBusy('Reading directory…');
        const handle = await window.showDirectoryPicker();
        const manifest = await ingestDirectoryHandle(handle);
        await finishLocal(manifest);
        setBusy(null);
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') {
          setBusy(null);
          return;
        }
      }
    }
    inputRef.current?.click();
  };

  const canAnalyze = !!token && !!diskPath.trim() && !busy;
  const manifestForLink = localManifest;

  return (
    <div
      className="panel import-drop"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => void onDrop(e)}
      data-animate
    >
      <div className="panel__head">
        <h2 className="panel__title">Link or import program</h2>
        <span className="panel__hint">link folder (recommended) · no upload, no copy</span>
      </div>
      <p className="page__subtitle">
        <strong>Recommended:</strong> enter the folder path below and click{' '}
        <strong>Link folder on disk</strong> — zero copy, no upload, the API reads your folder in place.
        Drop or pick a folder first for a quick browser preview (optional).
        Ignore rules strip node_modules/vendor/dist/.git before scanning.
      </p>

      <div className="field">
        <label htmlFor="disk-path">Folder on this PC</label>
        <input
          id="disk-path"
          value={diskPath}
          onChange={(e) => setDiskPath(e.target.value)}
          onBlur={() => persistDiskPath(diskPath)}
          placeholder="C:\Projects\my-app"
          disabled={!!busy}
        />
        <span className="field__hint">
          Must match the folder you are maintaining — the API reads it directly (same machine as{' '}
          <span className="mono">php artisan serve</span>).
        </span>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          type="button"
          className="btn btn--accent"
          disabled={!canAnalyze}
          onClick={() => void linkLocal(manifestForLink, diskPath)}
        >
          Link folder on disk
        </button>
        <button type="button" className="btn" onClick={() => void pickDirectory()} disabled={!!busy}>
          Choose folder (preview only)
        </button>
        <input
          ref={inputRef}
          type="file"
          // @ts-expect-error webkitdirectory is non-standard but required fallback
          webkitdirectory=""
          multiple
          hidden
          onChange={(e) => void previewFolder(e.target.files)}
        />
        <button
          type="button"
          className="btn"
          style={{ marginLeft: 'auto', color: 'var(--ink-4)', borderColor: 'var(--line-1)' }}
          disabled={!!busy}
          onClick={() => setShowZipUpload((v) => !v)}
        >
          {showZipUpload ? 'Hide zip upload' : 'Zip upload (copies to sandbox)…'}
        </button>
      </div>

      {busy && <p className="panel__hint" style={{ marginTop: 12 }}>{busy}</p>}
      {statsLine && (
        <p className="mono" style={{ marginTop: 8, fontSize: 'var(--text-sm)' }}>
          {statsLine}
        </p>
      )}
      {error && (
        <p role="alert" style={{ color: 'var(--status-critical)', marginTop: 8 }}>
          {error}
        </p>
      )}
      {!token && (
        <p className="field__hint" style={{ marginTop: 8 }}>
          Tip: paste a Sanctum token in Settings first (`php artisan token:issue jean@lss.local`).
        </p>
      )}
      {!diskPath.trim() && token && (
        <p className="field__hint" style={{ marginTop: 8 }}>
          Enter your project folder path above — the app will not upload until you use legacy zip upload.
        </p>
      )}
      {showZipUpload && localManifest && (
        <div style={{ marginTop: 12 }}>
          <p className="field__hint">
            Small projects only — large folders should use Analyze on disk.
          </p>
          <button
            type="button"
            className="btn"
            disabled={!!busy || !token}
            onClick={() => void upload(localManifest)}
          >
            Upload zip to API
          </button>
        </div>
      )}
      {project?.sourceType === 'local' && project.localSourcePath && (
        <p className="field__hint" style={{ marginTop: 8 }}>
          Active project is linked to <span className="mono">{project.localSourcePath}</span>. Re-scan from
          Diagnose or click Analyze on disk after edits.
        </p>
      )}
    </div>
  );
};

export default ImportDropzone;
