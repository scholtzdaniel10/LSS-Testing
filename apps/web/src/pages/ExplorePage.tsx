import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useHistory, useLocation } from 'react-router-dom';
import { useEntrance } from '../lib/anim';
import ScreenState from '../components/ScreenState';
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
  onFocusTree: (path: string) => void;
};

function RadialPanel({
  status,
  errorMessage,
  rollup,
  rollupMeta,
  focusPath,
  onFocusTree,
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
          onSelectFolder={onFocusTree}
        />
      )}
    </ScreenState>
  );
}

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
  const history = useHistory();
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
    ensureExploreData,
    ensureMapRollup,
  } = useProject();

  useEffect(() => {
    if (status === 'ready' && project?.id) void ensureMapRollup();
  }, [ensureMapRollup, project?.id, status]);

  useEffect(() => {
    void ensureExploreData();
  }, [ensureExploreData, project?.id]);
  const [selected, setSelected] = useState<string | null>(null);
  const [ideHint, setIdeHint] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ExploreView>('map');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const didInitExpand = useRef(false);

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

  // Scroll the focused file row into view when focusPath changes (not on every tree expand).
  const focusRowRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!focusPath) return;
    const frame = requestAnimationFrame(() => {
      focusRowRef.current?.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusPath]);

  // Sync radial map focus -> URL ?focus= param (keeps tree in step).
  const handleFocusTree = useCallback(
    (path: string) => {
      history.push(`/explore?focus=${encodeURIComponent(path)}`);
    },
    [history],
  );

  const outerScreenStatus = (
    status === 'ready' && treeNodes.length === 0 && !localManifest && rollupStatus !== 'ready' && rollupStatus !== 'loading' ? 'empty'
    : status === 'error' ? 'error'
    : treeNodes.length > 0 || localManifest || rollupStatus === 'ready' || rollupStatus === 'loading' ? 'ready'
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
              <div className="tree" role="tree">
                {treeNodes.map((node) => {
                  const isFocused = node.kind === 'file' && node.path === focusPath;
                  const isSelected = node.kind === 'file' && node.path === selected;
                  const isExpanded = node.kind === 'folder' && expandedFolders.has(node.path);

                  return (
                    <div
                      key={node.path}
                      ref={isFocused ? focusRowRef : undefined}
                      className={`tree__row${isSelected ? ' tree__row--selected' : ''}${node.kind === 'folder' ? ' tree__row--folder' : ''}`}
                      style={{ paddingLeft: 6 + node.depth * 14 }}
                      role="treeitem"
                      aria-expanded={node.kind === 'folder' ? isExpanded : undefined}
                      tabIndex={0}
                      onClick={() => {
                        if (node.kind === 'folder') {
                          toggleFolder(node.path);
                        } else {
                          openFile(node.path);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          if (node.kind === 'folder') {
                            toggleFolder(node.path);
                          } else {
                            openFile(node.path);
                          }
                        }
                      }}
                    >
                      {node.kind === 'folder' ? (
                        <span className="tree__chevron" aria-hidden="true">
                          {isExpanded ? '▾' : '▸'}
                        </span>
                      ) : (
                        <span
                          className="tree__dot"
                          style={{ background: SERIES[node.folder] ?? SERIES.other }}
                          aria-hidden="true"
                        />
                      )}
                      <span title={node.path} style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {node.name}{node.kind === 'folder' ? '/' : ''}
                      </span>
                      {node.errors > 0 && (
                        <span className="tree__badge tree__badge--err" aria-label={`${node.errors} error${node.errors !== 1 ? 's' : ''}`}>
                          {node.errors} err
                        </span>
                      )}
                      {node.kind === 'file' && node.links > 0 && (
                        <span className="tree__badge">
                          {node.links} links
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
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
                    onFocusTree={handleFocusTree}
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
