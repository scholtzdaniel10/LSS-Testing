import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useEntrance } from '../lib/anim';
import ScreenState from '../components/ScreenState';
import ExploreFileTree from '../components/ExploreFileTree';
import {
  buildFileTree,
  defaultExpandedFolders,
  expansionChainForFile,
} from '../lib/graphModel';
import { useProject, type RollupMeta } from '../state/ProjectContext';
import { loadEditorSettings, openInIde } from '../types';
import type { GraphRollup } from '../api/client';

type ExploreView = 'map' | 'graph';

const RollupMap = lazy(() => import('../components/RollupMap'));
const DependencyGraph = lazy(() => import('../components/DependencyGraph'));

type RadialPanelProps = {
  status: 'idle' | 'loading' | 'ready' | 'empty' | 'error';
  errorMessage: string | null;
  rollup: GraphRollup | null;
  rollupMeta: RollupMeta;
  focusPath: string | null;
};

function RadialPanel({
  status,
  errorMessage,
  rollup,
  rollupMeta,
  focusPath,
}: RadialPanelProps) {
  let screenStatus: 'idle' | 'loading' | 'ready' | 'empty' | 'error';
  if (status === 'error') {
    screenStatus = 'error';
  } else if (status === 'empty') {
    screenStatus = 'empty';
  } else if (status === 'ready' && rollup != null) {
    screenStatus = 'ready';
  } else if (status === 'ready') {
    screenStatus = 'empty';
  } else {
    screenStatus = status;
  }

  const emptyHint =
    rollupMeta.reason === 'no-graph-yet'
      ? 'No snapshot yet — run Analyze or Re-scan from the Projects page.'
      : 'No folders in the rollup — Map waits for graph/rollup, not file dots.';

  return (
    <ScreenState status={screenStatus} errorMessage={errorMessage} emptyHint={emptyHint}>
      {rollup != null && (
        <RollupMap
          rollup={rollup}
          meta={rollupMeta}
          focusParam={focusPath}
        />
      )}
    </ScreenState>
  );
}

const ExplorePage: React.FC = () => {
  const ref = useEntrance();
  const location = useLocation();
  const {
    tree,
    graphEdges,
    graphRollup,
    rollupStatus,
    rollupError,
    rollupMeta,
    errors,
    localManifest,
    status,
    errorMessage,
    usage,
    project,
    graphSnapshotId,
    ensureExploreData,
    ensureTree,
    ensureMapRollup,
  } = useProject();

  const [selected, setSelected] = useState<string | null>(null);
  const [ideHint, setIdeHint] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ExploreView>('map');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const didInitExpand = useRef(false);

  // IG-32: Map first-paint is GET /graph/rollup?depth=1 only — never GET /graph.
  useEffect(() => {
    if (status === 'ready' && project?.id) void ensureMapRollup();
  }, [ensureMapRollup, project?.id, status]);

  // Node tree may fetch /tree without /graph. Not a Map canvas request.
  useEffect(() => {
    if (status === 'ready' && project?.id) void ensureTree();
  }, [ensureTree, project?.id, status]);

  // Graph tab lazy-loads GET /graph (+ /tree if still missing) AFTER the user opens Graph.
  useEffect(() => {
    if (activeView !== 'graph') return;
    if (status === 'ready' && project?.id) void ensureExploreData();
  }, [activeView, ensureExploreData, project?.id, status]);

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

  // Build the full source file list (same logic as before, used for graph).
  const allFilePaths = useMemo(() => {
    const serverReady = tree.length > 0 && project?.lastImportedAt;
    return serverReady
      ? tree.map((t) => t.path)
      : (localManifest?.files.map((f) => f.path) ?? tree.map((t) => t.path));
  }, [tree, localManifest, project?.lastImportedAt]);

  // Initialise the expanded set once paths are available.
  useEffect(() => {
    if (allFilePaths.length > 0 && !didInitExpand.current) {
      didInitExpand.current = true;
      setExpandedFolders(defaultExpandedFolders(allFilePaths));
    }
  }, [allFilePaths]);

  // When focusPath changes: expand its ancestor chain and scroll it into view.
  useEffect(() => {
    if (!focusPath) return;
    const chain = expansionChainForFile(focusPath);
    if (chain.size > 0) {
      setExpandedFolders((prev) => {
        const next = new Set(prev);
        for (const f of chain) next.add(f);
        return next;
      });
    }
  }, [focusPath]);

  const errorCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of errors) {
      map.set(e.file, (map.get(e.file) ?? 0) + 1);
    }
    return map;
  }, [errors]);

  const linkCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const edge of graphEdges) {
      map.set(edge.from, (map.get(edge.from) ?? 0) + 1);
      map.set(edge.to, (map.get(edge.to) ?? 0) + 1);
    }
    return map;
  }, [graphEdges]);

  // Build the visible tree rows from the expanded set.
  const treeNodes = useMemo(
    () => buildFileTree(allFilePaths, expandedFolders, linkCount, errorCount),
    [allFilePaths, expandedFolders, linkCount, errorCount],
  );

  const errorFiles = useMemo(() => errorCount, [errorCount]);

  const snapshotId =
    graphSnapshotId
    ?? (project ? `${project.id}:pending:${allFilePaths.length}` : `local:${allFilePaths.length}`);

  const openFile = (path: string, line = 1) => {
    setSelected(path);
    const ok = openInIde(loadEditorSettings(), path, line, project?.name);
    setIdeHint(
      ok
        ? null
        : 'Set Local project root in Settings to the folder you imported (e.g. C:\\Users\\Jean\\Documents\\LSS-Testing\\LSS-Testing).',
    );
  };

  const toggleFolder = useCallback((folderPath: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderPath)) {
        // Collapse this folder and all descendants.
        for (const f of next) {
          if (f === folderPath || f.startsWith(`${folderPath}/`)) {
            next.delete(f);
          }
        }
      } else {
        next.add(folderPath);
      }
      return next;
    });
  }, []);

  const mapHasState =
    rollupStatus === 'loading' || rollupStatus === 'ready' || rollupStatus === 'empty' || rollupStatus === 'error';
  const outerScreenStatus = (
    status === 'error' ? 'error'
    : status === 'ready' && !project && !localManifest && !mapHasState ? 'empty'
    : treeNodes.length > 0 || localManifest || mapHasState || project ? 'ready'
    : status
  ) as 'idle' | 'loading' | 'ready' | 'empty' | 'error';

  return (
    <div className="page">
      <div className="page__inner" ref={ref} style={{ maxWidth: 1320 }}>
        <div data-animate>
          <h1 className="page__title">Explore</h1>
          <p className="page__subtitle">
            Node tree and dependency graph for the active project.
            {project ? (
              <>
                {' '}
                {'·'} active <span className="mono">{project.name}</span>
              </>
            ) : null}
            {usage?.uses ? (
              <>
                {' '}
                {'·'} Uses: {(usage.uses.frameworks ?? []).join(', ') || '—'}{' '}
                {'·'} languages:{' '}
                {(usage.uses.languages ?? []).join(', ') || '—'}
              </>
            ) : null}
          </p>
        </div>

        <ScreenState
          status={outerScreenStatus}
          errorMessage={errorMessage}
          emptyHint="No project open yet."
        >
          <div className="split" data-animate>
            <div className="panel">
              <div className="panel__head">
                <h2 className="panel__title">Node tree</h2>
                <span className="panel__hint">
                  {allFilePaths.length.toLocaleString()} files
                  {localManifest && !(tree.length > 0 && project?.lastImportedAt) ? ' · local preview' : ' · from API'}
                </span>
              </div>
              <ExploreFileTree
                nodes={treeNodes}
                expandedFolders={expandedFolders}
                selected={selected}
                focusPath={focusPath}
                onToggleFolder={toggleFolder}
                onOpenFile={(path) => openFile(path)}
              />
            </div>

            <div className="panel">
              <div className="panel__head">
                <h2 className="panel__title">
                  {activeView === 'map' ? 'Codebase map' : 'Dependency graph'}
                </h2>
                <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
                  <span className="panel__hint">
                    {activeView === 'map' ? 'folder hubs · from rollup' : 'module clusters · drill down on click'}
                  </span>
                  <div
                    role="group"
                    aria-label="View toggle"
                    style={{ display: 'flex', gap: '2px', background: 'var(--surface-raised)', borderRadius: 'var(--radius-sm)', padding: '2px' }}
                  >
                    <button
                      type="button"
                      aria-pressed={activeView === 'map'}
                      onClick={() => setActiveView('map')}
                      style={{
                        fontSize: 'var(--text-xs)',
                        padding: '2px 8px',
                        borderRadius: 'var(--radius-sm)',
                        border: 'none',
                        cursor: 'pointer',
                        background: activeView === 'map' ? 'var(--surface-wash)' : 'none',
                        color: activeView === 'map' ? 'var(--ink-1)' : 'var(--ink-3)',
                      }}
                    >
                      Map
                    </button>
                    <button
                      type="button"
                      aria-pressed={activeView === 'graph'}
                      onClick={() => setActiveView('graph')}
                      style={{
                        fontSize: 'var(--text-xs)',
                        padding: '2px 8px',
                        borderRadius: 'var(--radius-sm)',
                        border: 'none',
                        cursor: 'pointer',
                        background: activeView === 'graph' ? 'var(--surface-wash)' : 'none',
                        color: activeView === 'graph' ? 'var(--ink-1)' : 'var(--ink-3)',
                      }}
                    >
                      Graph
                    </button>
                  </div>
                </div>
              </div>

              {activeView === 'map' ? (
                <Suspense fallback={<p className="panel__hint">Loading map…</p>}>
                  <RadialPanel
                    status={rollupStatus}
                    errorMessage={rollupError}
                    rollup={graphRollup}
                    rollupMeta={rollupMeta}
                    focusPath={focusPath}
                  />
                </Suspense>
              ) : (
                <ScreenState
                  status={
                    status === 'error'
                      ? 'error'
                      : status === 'ready' && graphEdges.length === 0 && allFilePaths.length === 0
                        ? 'empty'
                        : graphEdges.length > 0 || allFilePaths.length > 0
                          ? 'ready'
                          : status
                  }
                  errorMessage={errorMessage}
                  emptyHint="No graph yet — open a project from Projects and run Analyze."
                >
                  <Suspense fallback={<p className="panel__hint">Loading graph…</p>}>
                    <DependencyGraph
                      snapshotId={snapshotId}
                      edges={graphEdges}
                      errorFiles={errorFiles}
                      files={allFilePaths}
                      frameworks={usage?.uses?.frameworks ?? []}
                      selected={selected}
                      onSelect={setSelected}
                      onOpenFile={(path) => openFile(path)}
                      focusPath={focusPath}
                    />
                  </Suspense>
                  {ideHint && (
                    <p role="status" className="field__hint" style={{ marginTop: 8 }}>
                      {ideHint}
                    </p>
                  )}
                  {linkedError && (
                    <div
                      className="panel"
                      style={{ marginTop: 8, borderLeft: '3px solid var(--status-critical)', padding: 'var(--sp-3)' }}
                      role="status"
                      aria-label="Linked diagnostic finding"
                    >
                      <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--status-critical)', fontWeight: 600 }}>
                        {linkedError.kind} {'·'} {linkedError.ruleId}
                      </p>
                      <p style={{ margin: 'var(--sp-1) 0 0', fontSize: 'var(--text-sm)', color: 'var(--ink-2)' }}>
                        {linkedError.explanation ?? linkedError.message}
                      </p>
                      <p style={{ margin: 'var(--sp-1) 0 0', fontSize: 'var(--text-xs)', color: 'var(--ink-3)' }}>
                        {linkedError.file}:{linkedError.range.startLine}
                      </p>
                    </div>
                  )}
                </ScreenState>
              )}
            </div>
          </div>
        </ScreenState>

        {status !== 'loading' && status !== 'idle' && !project && (
          <div className="panel" data-animate>
            <p className="page__subtitle">
              No project open.{' '}
              <NavLink to="/projects" className="topnav__link" style={{ fontSize: 'var(--text-base)', position: 'static' }}>
                Go to Projects
              </NavLink>{' '}
              to link a folder or upload a zip.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ExplorePage;
