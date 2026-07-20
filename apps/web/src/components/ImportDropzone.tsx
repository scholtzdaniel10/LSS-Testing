import { useCallback, useRef, useState } from 'react';
import { ApiError, api, getApiToken, pollJob, setActiveProjectId } from '../api/client';
import {
  ingestDirectoryHandle,
  ingestFileList,
  saveLocalProject,
  type LocalProjectManifest,
} from '../lib/localProjectStore';
import { zipLocalFiles } from '../lib/zipUpload';
import { loadEditorSettings } from '../types';
import { useProject } from '../state/ProjectContext';

/**
 * IG-17/18/19: drop a folder → ignore rules + IndexedDB tree → zip upload.
 */
const ImportDropzone: React.FC = () => {
  const { setLocalManifest, reloadAll, selectProject, token } = useProject();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [statsLine, setStatsLine] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const finishLocal = async (manifest: LocalProjectManifest) => {
    await saveLocalProject(manifest);
    setLocalManifest(manifest);
    setStatsLine(
      `Kept ${manifest.stats.kept.toLocaleString()} · skipped ${manifest.stats.skipped.toLocaleString()} ` +
        `(${Object.entries(manifest.stats.skippedByRule)
          .map(([k, v]) => `${k}: ${v}`)
          .join(', ') || 'none'})`,
    );
    return manifest;
  };

  const uniqueName = async (base: string): Promise<string> => {
    const { data: existing } = await api.projects();
    const names = new Set(existing.map((p) => p.name));
    if (!names.has(base)) return base;
    let i = 2;
    while (names.has(`${base}-${i}`)) i += 1;
    return `${base}-${i}`;
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

      setBusy('Creating project…');
      let projectId = manifest.serverProjectId;
      let name = manifest.name;
      if (!projectId) {
        name = await uniqueName(manifest.name);
        const created = await api.createProject(name);
        projectId = created.data.id;
      }
      setActiveProjectId(projectId);

      setBusy('Uploading zip (import runs on the API)…');
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
      setBusy('Import complete — switching to new project…');
      selectProject(projectId);
      await reloadAll();
      setBusy(null);
      setError(null);
      if (!loadEditorSettings().localRoot.trim()) {
        setStatsLine(
          (prev) =>
            `${prev ?? ''} · Set Local project root in Settings so Open in IDE works.`,
        );
      }
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Import failed';
      setError(msg);
      setBusy(null);
    }
  };

  const onFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      setError(null);
      setBusy('Reading local folder…');
      try {
        const manifest = await ingestFileList(
          files,
          files[0]?.webkitRelativePath?.split(/[/\\]/)[0] ?? 'program',
        );
        await finishLocal(manifest);
        await upload(manifest);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Import failed');
        setBusy(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [token],
  );

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
          await upload(manifest);
          return;
        }
      } catch {
        // fall through
      }
    }
    await onFiles(e.dataTransfer.files);
  };

  const pickDirectory = async () => {
    if ('showDirectoryPicker' in window) {
      try {
        setBusy('Reading directory…');
        const handle = await window.showDirectoryPicker();
        const manifest = await ingestDirectoryHandle(handle);
        await finishLocal(manifest);
        await upload(manifest);
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') {
          setBusy(null);
          return;
        }
        // fall through to input
      }
    }
    inputRef.current?.click();
  };

  return (
    <div
      className="panel import-drop"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => void onDrop(e)}
      data-animate
    >
      <div className="panel__head">
        <h2 className="panel__title">Import program</h2>
        <span className="panel__hint">IG-17/18/19 · local-first, then upload</span>
      </div>
      <p className="page__subtitle">
        Drop a folder (or pick one). Ignore rules strip node_modules/vendor/dist/.git/.angular client-side
        before anything is uploaded. Until you import, Explore shows the seeded demo{' '}
        <span className="mono">lexpro-portal</span>.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn--accent" onClick={() => void pickDirectory()} disabled={!!busy}>
          Choose folder
        </button>
        <input
          ref={inputRef}
          type="file"
          // @ts-expect-error webkitdirectory is non-standard but required fallback
          webkitdirectory=""
          multiple
          hidden
          onChange={(e) => void onFiles(e.target.files)}
        />
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
    </div>
  );
};

export default ImportDropzone;
