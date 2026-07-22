import { useState } from 'react';
import { useHistory } from 'react-router-dom';
import { useEntrance } from '../lib/anim';
import ScreenState from '../components/ScreenState';
import { useProject } from '../state/ProjectContext';
import { relativeTime } from '../lib/timeFormat';
import { api, ApiError, pollJob } from '../api/client';
import { linkLocalFolder } from '../lib/linkLocalProject';
import { isNotUnderAllowedRootError } from '../lib/localRootErrors';
import type { Project } from '../api/client';

// ── New-project wizard state ──────────────────────────────────────────────────
type WizardStep = 'idle' | 'name' | 'method' | 'link' | 'uploading';

const ProjectsPage: React.FC = () => {
  const ref = useEntrance();
  const history = useHistory();
  const { projects, selectProject, deleteProject, refreshProjects, status, errorMessage, jobMessage } =
    useProject();

  // Wizard
  const [wizardStep, setWizardStep] = useState<WizardStep>('idle');
  const [newName, setNewName] = useState('');
  const [linkPath, setLinkPath] = useState('');
  const [wizardBusy, setWizardBusy] = useState<string | null>(null);
  const [wizardError, setWizardError] = useState<string | null>(null);
  // Consent card: shown when link fails because path is not under an allowed root
  const [consentPath, setConsentPath] = useState<string | null>(null);
  const [consentBusy, setConsentBusy] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);

  // Per-card state
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [cardBusy, setCardBusy] = useState<Record<string, string>>({});

  // ── helpers ──────────────────────────────────────────────────────────────────

  const resetWizard = () => {
    setWizardStep('idle');
    setNewName('');
    setLinkPath('');
    setWizardBusy(null);
    setWizardError(null);
    setConsentPath(null);
    setConsentBusy(false);
    setConsentError(null);
  };

  const handleOpen = (p: Project) => {
    selectProject(p.id);
    history.push('/explore');
  };

  const handleRescan = async (p: Project) => {
    setCardBusy((prev) => ({ ...prev, [p.id]: 'Queuing re-scan…' }));
    try {
      const { data } = await api.rescan(p.id);
      setCardBusy((prev) => ({ ...prev, [p.id]: `Analyze job ${data.analyzeJobId}…` }));
      await pollJob(data.analyzeJobId, (j) =>
        setCardBusy((prev) => ({ ...prev, [p.id]: `Analyze: ${j.status} ${j.progress}%` })),
      );
      await pollJob(data.snapshotJobId, (j) =>
        setCardBusy((prev) => ({ ...prev, [p.id]: `Snapshot: ${j.status} ${j.progress}%` })),
      );
      await refreshProjects();
      setCardBusy((prev) => ({ ...prev, [p.id]: 'Re-scan complete' }));
      setTimeout(() => {
        setCardBusy((prev) => {
          const next = { ...prev };
          delete next[p.id];
          return next;
        });
      }, 2000);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Re-scan failed';
      setCardBusy((prev) => ({ ...prev, [p.id]: msg }));
      setTimeout(() => {
        setCardBusy((prev) => {
          const next = { ...prev };
          delete next[p.id];
          return next;
        });
      }, 4000);
    }
  };

  const handleDelete = async (p: Project) => {
    setCardBusy((prev) => ({ ...prev, [p.id]: 'Deleting…' }));
    try {
      await deleteProject(p.id);
    } catch {
      // error shown via jobMessage
    } finally {
      setCardBusy((prev) => {
        const next = { ...prev };
        delete next[p.id];
        return next;
      });
      setConfirmDelete(null);
    }
  };

  // ── Wizard: link local ────────────────────────────────────────────────────
  const handleLinkLocal = async (pathOverride?: string) => {
    const trimmed = (pathOverride ?? linkPath).trim();
    if (!trimmed) {
      setWizardError('Enter the full folder path on this machine.');
      return;
    }
    setWizardBusy('Creating project…');
    setWizardError(null);
    setConsentPath(null);
    setConsentError(null);
    try {
      await linkLocalFolder(trimmed, {
        projectName: newName.trim() || undefined,
        onStatus: setWizardBusy,
      });
      await refreshProjects();
      resetWizard();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Link failed';
      setWizardBusy(null);
      if (isNotUnderAllowedRootError(msg)) {
        setConsentPath(trimmed);
      } else {
        setWizardError(msg);
      }
    }
  };

  // ── Consent card handlers ─────────────────────────────────────────────────
  const handleConsentAllow = async () => {
    if (!consentPath) return;
    setConsentBusy(true);
    setConsentError(null);
    try {
      await api.addLocalRoot(consentPath);
      setConsentPath(null);
      // Retry the link automatically now that the root is registered.
      await handleLinkLocal(consentPath);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Failed to register root';
      setConsentError(msg);
      setConsentBusy(false);
    }
  };

  const handleConsentCancel = () => {
    setConsentPath(null);
    setConsentError(null);
    setConsentBusy(false);
  };

  // ── Wizard: zip upload ────────────────────────────────────────────────────
  const handleZipUpload = async (file: File) => {
    const name = newName.trim() || file.name.replace(/\.zip$/i, '');
    setWizardBusy('Creating project…');
    setWizardError(null);
    try {
      const created = await api.createProject(name);
      const projectId = created.data.id;
      setWizardBusy('Uploading zip…');
      const result = await api.importZip(projectId, file, name);
      if (result.data.status === 'failed') {
        throw new Error(result.data.message ?? 'Import failed on server');
      }
      setWizardBusy('Import job queued — switching to project…');
      selectProject(projectId);
      await refreshProjects();
      resetWizard();
      history.push('/explore');
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Upload failed';
      setWizardError(msg);
      setWizardBusy(null);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  const pageStatus =
    status === 'loading' || status === 'idle'
      ? status
      : projects.length === 0
        ? 'empty'
        : 'ready';

  return (
    <div className="page">
      <div className="page__inner" ref={ref}>
        <div data-animate>
          <h1 className="page__title">Projects</h1>
          <p className="page__subtitle">Manage analyzed codebases. Open one to explore its graph and diagnostics.</p>
        </div>

        {jobMessage && (
          <p className="v0-banner" role="status" data-animate>
            {jobMessage}
          </p>
        )}

        {/* ── New-project wizard ─────────────────────────────────────────── */}
        {wizardStep === 'idle' && (
          <div data-animate>
            <button
              type="button"
              className="btn btn--accent"
              onClick={() => setWizardStep('name')}
            >
              + New project
            </button>
          </div>
        )}

        {wizardStep === 'name' && (
          <div className="panel" data-animate>
            <div className="panel__head">
              <h2 className="panel__title">New project — name</h2>
            </div>
            <div className="field">
              <label htmlFor="new-proj-name">Project name</label>
              <input
                id="new-proj-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="my-app"
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && newName.trim() && setWizardStep('method')}
              />
              <span className="field__hint">Can be left blank — it will be inferred from the folder or zip name.</span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="btn btn--accent"
                onClick={() => setWizardStep('method')}
              >
                Continue
              </button>
              <button type="button" className="btn" onClick={resetWizard}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {wizardStep === 'method' && (
          <div className="panel" data-animate>
            <div className="panel__head">
              <h2 className="panel__title">New project — choose method</h2>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <button
                type="button"
                className="btn btn--accent"
                style={{ justifyContent: 'flex-start', textAlign: 'left' }}
                onClick={() => setWizardStep('link')}
              >
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span>Link folder on this machine (recommended)</span>
                  <span
                    className="field__hint"
                    style={{ fontWeight: 400, color: 'var(--ink-3)' }}
                  >
                    Zero copy, no upload — the API reads your folder in place. Best for large codebases.
                  </span>
                </span>
              </button>
              <button
                type="button"
                className="btn"
                style={{ justifyContent: 'flex-start', textAlign: 'left' }}
                onClick={() => setWizardStep('uploading')}
              >
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span>Upload zip (copies codebase into app sandbox)</span>
                  <span
                    className="field__hint"
                    style={{ fontWeight: 400, color: 'var(--ink-4)' }}
                  >
                    For small projects only — max ~1.9 MB zip. The server keeps a copy until you delete the project.
                  </span>
                </span>
              </button>
            </div>
            <div style={{ marginTop: 12 }}>
              <button type="button" className="btn" onClick={() => setWizardStep('name')}>
                Back
              </button>
            </div>
          </div>
        )}

        {wizardStep === 'link' && (
          <div className="panel" data-animate>
            <div className="panel__head">
              <h2 className="panel__title">New project — link folder</h2>
            </div>
            <div className="field">
              <label htmlFor="link-path">Full folder path on this machine</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  id="link-path"
                  value={linkPath}
                  onChange={(e) => setLinkPath(e.target.value)}
                  placeholder="C:\Projects\my-app"
                  autoFocus
                  disabled={!!wizardBusy}
                  style={{ flex: 1 }}
                  onKeyDown={(e) => e.key === 'Enter' && !wizardBusy && void handleLinkLocal()}
                />
                {typeof window !== 'undefined' && window.lssDesktop?.pickFolder && (
                  <button
                    type="button"
                    className="btn"
                    disabled={!!wizardBusy}
                    onClick={() => {
                      void window.lssDesktop!.pickFolder().then((p) => {
                        if (p) setLinkPath(p);
                      });
                    }}
                  >
                    Browse…
                  </button>
                )}
              </div>
              <span className="field__hint">
                Must be accessible from the machine running{' '}
                <span className="mono">php artisan serve</span>. Folders must be allowed once
                before linking — you can manage allowed folders in Settings.
              </span>
            </div>

            {/* Consent card — shown when link fails due to missing root registration */}
            {consentPath && !wizardBusy && (
              <div
                role="alertdialog"
                style={{
                  margin: '8px 0',
                  padding: 'var(--sp-3)',
                  border: '1px solid var(--status-warn)',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--surface-page)',
                }}
              >
                <p style={{ margin: '0 0 var(--sp-2)', fontSize: 'var(--text-sm)', color: 'var(--ink-1)' }}>
                  Allow the engine to read everything under{' '}
                  <span className="mono" style={{ wordBreak: 'break-all' }}>{consentPath}</span>?
                </p>
                {consentError && (
                  <p role="alert" style={{ color: 'var(--status-critical)', fontSize: 'var(--text-sm)', margin: '0 0 var(--sp-2)' }}>
                    {consentError}
                  </p>
                )}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    className="btn btn--accent"
                    disabled={consentBusy}
                    onClick={() => void handleConsentAllow()}
                  >
                    {consentBusy ? 'Allowing…' : 'Allow'}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={consentBusy}
                    onClick={handleConsentCancel}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {wizardBusy && (
              <p className="panel__hint" style={{ marginBottom: 8 }}>
                {wizardBusy}
              </p>
            )}
            {wizardError && (
              <p
                role="alert"
                style={{
                  color: 'var(--status-critical)',
                  marginBottom: 8,
                  whiteSpace: 'pre-wrap',
                  fontSize: 'var(--text-sm)',
                }}
              >
                {wizardError}
              </p>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="btn btn--accent"
                disabled={!!wizardBusy || !linkPath.trim()}
                onClick={() => void handleLinkLocal()}
              >
                Link folder
              </button>
              <button type="button" className="btn" onClick={() => setWizardStep('method')} disabled={!!wizardBusy}>
                Back
              </button>
              <button type="button" className="btn" onClick={resetWizard} disabled={!!wizardBusy}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {wizardStep === 'uploading' && (
          <div className="panel" data-animate>
            <div className="panel__head">
              <h2 className="panel__title">New project — upload zip</h2>
            </div>
            <p className="page__subtitle" style={{ marginBottom: 12 }}>
              Small projects only (max ~1.9 MB after compression). The API keeps a copy on disk.
            </p>
            {wizardBusy && (
              <p className="panel__hint" style={{ marginBottom: 8 }}>
                {wizardBusy}
              </p>
            )}
            {wizardError && (
              <p
                role="alert"
                style={{ color: 'var(--status-critical)', marginBottom: 8, fontSize: 'var(--text-sm)' }}
              >
                {wizardError}
              </p>
            )}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <label className="btn btn--accent" style={{ cursor: 'pointer' }}>
                Choose zip file
                <input
                  type="file"
                  accept=".zip"
                  hidden
                  disabled={!!wizardBusy}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleZipUpload(f);
                  }}
                />
              </label>
              <button type="button" className="btn" onClick={() => setWizardStep('method')} disabled={!!wizardBusy}>
                Back
              </button>
              <button type="button" className="btn" onClick={resetWizard} disabled={!!wizardBusy}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* ── Project list ─────────────────────────────────────────────────── */}
        <ScreenState
          status={pageStatus}
          errorMessage={errorMessage}
          emptyHint="No projects yet — click '+ New project' above to link a folder or upload a zip."
        >
          <div
            style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}
            data-animate
          >
            {projects.map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                busy={cardBusy[p.id] ?? null}
                confirming={confirmDelete === p.id}
                onOpen={() => handleOpen(p)}
                onRescan={() => void handleRescan(p)}
                onDeleteRequest={() => setConfirmDelete(p.id)}
                onDeleteConfirm={() => void handleDelete(p)}
                onDeleteCancel={() => setConfirmDelete(null)}
              />
            ))}
          </div>
        </ScreenState>
      </div>
    </div>
  );
};

// ── Project card ─────────────────────────────────────────────────────────────

type CardProps = {
  project: Project;
  busy: string | null;
  confirming: boolean;
  onOpen: () => void;
  onRescan: () => void;
  onDeleteRequest: () => void;
  onDeleteConfirm: () => void;
  onDeleteCancel: () => void;
};

const ProjectCard: React.FC<CardProps> = ({
  project: p,
  busy,
  confirming,
  onOpen,
  onRescan,
  onDeleteRequest,
  onDeleteConfirm,
  onDeleteCancel,
}) => {
  const isLocal = p.sourceType === 'local';

  return (
    <div className="panel">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--sp-4)' }}>
        {/* Main info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-1)' }}>
            <span style={{ fontWeight: 700, color: 'var(--ink-1)', fontSize: 'var(--text-md)' }}>
              {p.name}
            </span>
            <span
              className="mono"
              style={{
                fontSize: 'var(--text-xs)',
                color: isLocal ? 'var(--status-good)' : 'var(--ink-4)',
                border: '1px solid var(--line-1)',
                borderRadius: 'var(--radius-sm)',
                padding: '1px 6px',
              }}
            >
              {isLocal ? 'Linked folder' : 'Imported copy'}
            </span>
          </div>

          {isLocal && p.localSourcePath ? (
            <p className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)', margin: '0 0 var(--sp-1)' }}>
              {p.localSourcePath}
            </p>
          ) : null}

          {!isLocal && p.sandboxSizeBytes != null ? (
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-4)', margin: '0 0 var(--sp-1)' }}>
              Copy on disk: {formatBytes(p.sandboxSizeBytes)}
            </p>
          ) : !isLocal ? (
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-4)', margin: '0 0 var(--sp-1)' }}>
              Copy on disk: —
            </p>
          ) : (
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-4)', margin: '0 0 var(--sp-1)' }}>
              0 B — reads from your folder
            </p>
          )}

          <div style={{ display: 'flex', gap: 'var(--sp-4)', fontSize: 'var(--text-xs)', color: 'var(--ink-3)' }}>
            <span>{p.fileCount ?? 0} files</span>
            <span>last import {relativeTime(p.lastImportedAt)}</span>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 'var(--sp-2)', flexShrink: 0, alignItems: 'center' }}>
          <button
            type="button"
            className="btn btn--accent"
            disabled={!!busy}
            onClick={onOpen}
          >
            Open
          </button>
          <button
            type="button"
            className="btn"
            disabled={!!busy}
            onClick={onRescan}
          >
            Re-scan
          </button>
          <button
            type="button"
            className="btn"
            disabled={!!busy}
            style={{ color: 'var(--status-critical)', borderColor: 'var(--status-critical)' }}
            onClick={onDeleteRequest}
          >
            Delete
          </button>
        </div>
      </div>

      {busy && (
        <p className="panel__hint" style={{ marginTop: 8 }}>
          {busy}
        </p>
      )}

      {confirming && (
        <div
          role="alertdialog"
          aria-modal="false"
          style={{
            marginTop: 'var(--sp-3)',
            padding: 'var(--sp-3)',
            border: '1px solid var(--status-critical)',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--surface-page)',
          }}
        >
          <p style={{ margin: '0 0 var(--sp-2)', fontSize: 'var(--text-sm)', color: 'var(--ink-1)' }}>
            Delete <strong>{p.name}</strong>?
            {!isLocal
              ? ' This will permanently remove the sandbox copy from disk.'
              : ' This removes the project record. Your folder on disk is untouched.'}
          </p>
          <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
            <button
              type="button"
              className="btn"
              style={{ color: 'var(--status-critical)', borderColor: 'var(--status-critical)' }}
              onClick={onDeleteConfirm}
            >
              Yes, delete
            </button>
            <button type="button" className="btn" onClick={onDeleteCancel}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default ProjectsPage;
