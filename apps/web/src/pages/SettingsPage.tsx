import { useEffect, useState } from 'react';
import { useEntrance } from '../lib/anim';
import { api, setApiToken, getApiToken } from '../api/client';
import { useProject } from '../state/ProjectContext';
import { linkLocalFolder } from '../lib/linkLocalProject';
import {
  defaultEditorSettings,
  loadEditorSettings,
  openInIde,
  saveEditorSettings,
  saveLocalProjectRoot,
  type EditorSettings,
} from '../types';

const SettingsPage: React.FC = () => {
  const ref = useEntrance();
  const { project, targets, setToken, reloadAll, projects, selectProject, deleteProject, jobMessage } =
    useProject();
  const [token, setTokenLocal] = useState(getApiToken);
  const [editor, setEditor] = useState<EditorSettings>(loadEditorSettings);
  const [envName, setEnvName] = useState('staging');
  const [envUrl, setEnvUrl] = useState('http://127.0.0.1');
  const [envNotes, setEnvNotes] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [probe, setProbe] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const first = targets[0];
    if (first) {
      setEnvName(first.name);
      setEnvUrl(first.baseUrl);
      setEnvNotes(first.notes ?? '');
    }
  }, [targets]);

  const saveToken = () => {
    setApiToken(token.trim());
    setToken(token.trim());
    setMessage('Token saved');
    void reloadAll();
  };

  const saveEditor = () => {
    saveEditorSettings(editor);
    setMessage('Editor settings saved (local)');
  };

  const onLocalRootBlur = () => {
    saveLocalProjectRoot(editor.localRoot);
  };

  const saveTarget = async () => {
    if (!project) {
      setMessage('Select a project first');
      return;
    }
    try {
      await api.saveTargetEnv(project.id, { name: envName, baseUrl: envUrl, notes: envNotes });
      setMessage('Target environment saved');
      await reloadAll();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Save failed');
    }
  };

  const removeProject = async () => {
    if (!project) {
      setMessage('Select a project first');
      return;
    }
    const ok = window.confirm(
      `Delete "${project.name}" from the API? This removes its sandbox, graph, and diagnostics. This cannot be undone.`,
    );
    if (!ok) return;
    setDeleting(true);
    setMessage(null);
    const name = project.name;
    try {
      await deleteProject(project.id);
      setMessage(`Deleted ${name}`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeleting(false);
    }
  };

  const runProbe = async () => {
    if (!project || !targets[0]) {
      setProbe('Save a target environment first');
      return;
    }
    const { data } = await api.probeTarget(project.id, targets[0].id);
    setProbe(data.reachable ? `Reachable (HTTP ${data.status})` : `Unreachable: ${data.error ?? data.status}`);
  };

  const linkLocalOnDisk = async () => {
    if (!project) {
      setMessage('Select a project first');
      return;
    }
    if (!editor.localRoot.trim()) {
      setMessage('Set Local project root to the folder on your PC first');
      return;
    }
    setLinking(true);
    setMessage(null);
    saveLocalProjectRoot(editor.localRoot);
    try {
      await linkLocalFolder(editor.localRoot.trim(), {
        projectId: project.id,
        projectName: project.name,
        onStatus: (m) => setMessage(m),
      });
      await reloadAll();
      setMessage(`Linked and analyzed ${editor.localRoot.trim()}`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Local link failed');
    } finally {
      setLinking(false);
    }
  };

  return (
    <div className="page">
      <div className="page__inner" ref={ref} style={{ maxWidth: 760 }}>
        <div data-animate>
          <h1 className="page__title">Settings</h1>
          <p className="page__subtitle">API auth, target environment, and your editor bridge.</p>
        </div>

        <div className="panel" data-animate>
          <div className="panel__head">
            <h2 className="panel__title">API token</h2>
            <span className="panel__hint">Sanctum bearer · never commit this</span>
          </div>
          <div className="field">
            <label htmlFor="api-token">Bearer token</label>
            <input
              id="api-token"
              value={token}
              onChange={(e) => setTokenLocal(e.target.value)}
              placeholder="php artisan token:issue jean@lss.local"
            />
          </div>
          <button type="button" className="btn btn--accent" onClick={saveToken}>
            Save token
          </button>
        </div>

        <div className="panel" data-animate>
          <div className="panel__head">
            <h2 className="panel__title">Active project</h2>
          </div>
          <div className="field">
            <label htmlFor="project">Project</label>
            <select
              id="project"
              value={project?.id ?? ''}
              onChange={(e) => selectProject(e.target.value)}
            >
              <option value="" disabled>
                Select…
              </option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          {project && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                type="button"
                className="btn"
                disabled={deleting || project.name === 'lexpro-portal'}
                onClick={() => void removeProject()}
                title={
                  project.name === 'lexpro-portal'
                    ? 'The seeded demo project cannot be deleted'
                    : 'Remove project and sandbox from the API'
                }
              >
                {deleting ? 'Deleting…' : 'Delete project'}
              </button>
              {project.name === 'lexpro-portal' && (
                <span className="field__hint">Demo project is protected.</span>
              )}
              {!project.lastImportedAt && project.name !== 'lexpro-portal' && (
                <span className="field__hint">Never imported — safe to delete failed attempts.</span>
              )}
            </div>
          )}
        </div>

        <div className="panel" data-animate>
          <div className="panel__head">
            <h2 className="panel__title">Target environment</h2>
            <span className="panel__hint">where your program runs — we never execute imported code</span>
          </div>
          <div className="field">
            <label htmlFor="env-name">Name</label>
            <input id="env-name" value={envName} onChange={(e) => setEnvName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="env-url">Base URL</label>
            <input id="env-url" value={envUrl} onChange={(e) => setEnvUrl(e.target.value)} />
            <span className="field__hint">Credentials are never stored (invariant 5)</span>
          </div>
          <div className="field">
            <label htmlFor="env-notes">Notes</label>
            <input id="env-notes" value={envNotes} onChange={(e) => setEnvNotes(e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn--accent" onClick={() => void saveTarget()}>
              Save target
            </button>
            <button type="button" className="btn" onClick={() => void runProbe()}>
              Probe reachability
            </button>
          </div>
          {probe && <p className="panel__hint" style={{ marginTop: 8 }}>{probe}</p>}
        </div>

        <div className="panel" data-animate>
          <div className="panel__head">
            <h2 className="panel__title">Open in my IDE</h2>
            <span className="panel__hint">IG-15 · persisted in this browser</span>
          </div>
          <div className="field">
            <label htmlFor="ide-preset">Editor</label>
            <select
              id="ide-preset"
              value={editor.editor}
              onChange={(e) => setEditor({ ...editor, editor: e.target.value as EditorSettings['editor'] })}
            >
              <option value="vscode">VS Code</option>
              <option value="phpstorm">PhpStorm</option>
              <option value="sublime">Sublime Text</option>
              <option value="custom">Custom command…</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="local-root">Local project root</label>
            <input
              id="local-root"
              value={editor.localRoot}
              onChange={(e) => setEditor({ ...editor, localRoot: e.target.value })}
              onBlur={onLocalRootBlur}
              placeholder="C:\Users\Jean\Documents\LSS-Testing\LSS-Testing"
            />
            <span className="field__hint">Required for Explore graph/tree clicks to open files in your editor.</span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn--accent"
              disabled={linking || !project || !editor.localRoot.trim() || !token}
              onClick={() => void linkLocalOnDisk()}
            >
              {linking ? 'Linking…' : 'Link & analyze on disk'}
            </button>
            <span className="field__hint" style={{ alignSelf: 'center' }}>
              No zip upload — API reads this folder directly (same PC as php artisan serve).
            </span>
          </div>
          {editor.editor === 'custom' && (
            <div className="field">
              <label htmlFor="custom-tpl">Template</label>
              <input
                id="custom-tpl"
                value={editor.customTemplate}
                onChange={(e) => setEditor({ ...editor, customTemplate: e.target.value })}
                placeholder="{path}:{line}"
              />
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn--accent" onClick={saveEditor}>
              Save editor settings
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => openInIde(editor.localRoot ? editor : { ...defaultEditorSettings(), ...editor }, 'README.md', 1)}
            >
              Test launch
            </button>
          </div>
        </div>

        {message && <p className="v0-banner" data-animate>{message}</p>}
        {jobMessage && !message && (
          <p className="panel__hint" data-animate style={{ marginTop: 12 }}>
            {jobMessage}
          </p>
        )}
      </div>
    </div>
  );
};

export default SettingsPage;
