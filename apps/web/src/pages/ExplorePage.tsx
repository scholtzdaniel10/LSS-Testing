import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useEntrance } from '../lib/anim';
import ImportDropzone from '../components/ImportDropzone';
import DependencyGraph from '../components/DependencyGraph';
import ScreenState from '../components/ScreenState';
import { folderOf } from '../lib/graphModel';
import { useProject } from '../state/ProjectContext';
import { loadEditorSettings, openInIde } from '../types';

const SERIES: Record<string, string> = {
  app: 'var(--series-1)',
  application: 'var(--series-1)',
  routes: 'var(--series-2)',
  resources: 'var(--series-3)',
  database: 'var(--series-4)',
  src: 'var(--series-1)',
  system: 'var(--series-2)',
  other: 'var(--series-other)',
};

const ExplorePage: React.FC = () => {
  const ref = useEntrance();
  const location = useLocation();
  const { tree, graphEdges, errors, localManifest, status, errorMessage, usage, project } = useProject();
  const [selected, setSelected] = useState<string | null>(null);
  const [ideHint, setIdeHint] = useState<string | null>(null);

  // Deep-link params: /explore?focus=<path>&errorId=<id>
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const focusPath = params.get('focus');
  const linkedErrorId = params.get('errorId');

  // When arriving via deep-link, pre-select the focused file.
  useEffect(() => {
    if (focusPath) setSelected(focusPath);
  }, [focusPath]);

  // Find the linked error (for the detail panel annotation).
  const linkedError = useMemo(
    () => (linkedErrorId ? errors.find((e) => e.id === linkedErrorId) ?? null : null),
    [linkedErrorId, errors],
  );

  const openFile = (path: string, line = 1) => {
    setSelected(path);
    const ok = openInIde(loadEditorSettings(), path, line, project?.name);
    setIdeHint(
      ok
        ? null
        : 'Set Local project root in Settings to the folder you imported (e.g. C:\\Users\\Jean\\Documents\\LSS-Testing\\LSS-Testing).',
    );
  };

  const { rows: treeRows, localOnly } = useMemo(() => {
    const serverReady = tree.length > 0 && project?.lastImportedAt;
    const isLocalOnly = !!localManifest && !serverReady;
    const source = serverReady
      ? tree.map((t) => t.path)
      : (localManifest?.files.map((f) => f.path) ?? tree.map((t) => t.path));
    const errorCount = new Map<string, number>();
    for (const e of errors) {
      errorCount.set(e.file, (errorCount.get(e.file) ?? 0) + 1);
    }
    const linkCount = new Map<string, number>();
    for (const edge of graphEdges) {
      linkCount.set(edge.from, (linkCount.get(edge.from) ?? 0) + 1);
      linkCount.set(edge.to, (linkCount.get(edge.to) ?? 0) + 1);
    }
    return {
      localOnly: isLocalOnly,
      rows: source.slice(0, 400).map((path) => ({
        path,
        depth: path.split('/').length - 1,
        folder: folderOf(path),
        links: linkCount.get(path) ?? 0,
        errors: errorCount.get(path) ?? 0,
      })),
    };
  }, [tree, localManifest, errors, graphEdges, project?.lastImportedAt]);

  const errorFiles = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of errors) {
      map.set(e.file, (map.get(e.file) ?? 0) + 1);
    }
    return map;
  }, [errors]);

  // The graph rolls files up into folder nodes (clean at any size) and drills
  // down on click, so it gets the full file list — not the 400-row tree slice.
  const allFilePaths = useMemo(() => {
    const serverReady = tree.length > 0 && project?.lastImportedAt;
    return serverReady
      ? tree.map((t) => t.path)
      : (localManifest?.files.map((f) => f.path) ?? tree.map((t) => t.path));
  }, [tree, localManifest, project?.lastImportedAt]);

  return (
    <div className="page">
      <div className="page__inner" ref={ref} style={{ maxWidth: 1320 }}>
        <div data-animate>
          <h1 className="page__title">Explore</h1>
          <p className="page__subtitle">
            Drag a program in locally, then explore the node tree and dependency graph.
            {project ? (
              <>
                {' '}
                · active <span className="mono">{project.name}</span>
              </>
            ) : null}
            {usage?.uses ? (
              <>
                {' '}
                · Uses: {(usage.uses.frameworks ?? []).join(', ') || '—'} · languages:{' '}
                {(usage.uses.languages ?? []).join(', ') || '—'}
              </>
            ) : null}
          </p>
        </div>

        <ImportDropzone />

        {localOnly && (
          <p className="v0-banner" role="status" data-animate>
            Browser preview only — enter your folder path above and click <strong>Analyze on disk</strong>{' '}
            for links and PHPStan (no upload).
          </p>
        )}

        <ScreenState
          status={status === 'ready' && treeRows.length === 0 && !localManifest ? 'empty' : status === 'error' ? 'error' : treeRows.length || localManifest ? 'ready' : status}
          errorMessage={errorMessage}
          emptyHint="No files yet — drop a folder above, or link a project in Settings."
        >
          <div className="split" data-animate>
            <div className="panel">
              <div className="panel__head">
                <h2 className="panel__title">Node tree</h2>
                <span className="panel__hint">
                  {treeRows.length.toLocaleString()} shown
                  {localOnly ? ' · local preview (no API analysis yet)' : ' · from API'}
                </span>
              </div>
              <div className="tree">
                {treeRows.map((item) => (
                  <div
                    key={item.path}
                    className="tree__row"
                    style={{ paddingLeft: 6 + Math.min(item.depth, 8) * 14 }}
                    role="button"
                    tabIndex={0}
                    onClick={() => openFile(item.path)}
                    onKeyDown={(e) => e.key === 'Enter' && openFile(item.path)}
                  >
                    <span className="tree__dot" style={{ background: SERIES[item.folder] ?? SERIES.other }} aria-hidden="true" />
                    <span title={item.path}>{item.path.split('/').pop()}</span>
                    <span className={`tree__badge ${item.errors > 0 ? 'tree__badge--err' : ''}`}>
                      {item.links} links{item.errors > 0 ? ` · ${item.errors} err` : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="panel">
              <div className="panel__head">
                <h2 className="panel__title">Dependency graph</h2>
                <span className="panel__hint">folder view · drill down on click</span>
              </div>
              {graphEdges.length === 0 && allFilePaths.length === 0 ? (
                <p className="page__subtitle">No graph yet — import a program or switch project in the header.</p>
              ) : (
                <DependencyGraph
                  edges={graphEdges}
                  errorFiles={errorFiles}
                  files