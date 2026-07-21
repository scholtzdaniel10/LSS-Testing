import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useEntrance } from '../lib/anim';
import ImportDropzone from '../components/ImportDropzone';
import DependencyGraph from '../components/DependencyGraph';
import ScreenState from '../components/ScreenState';
import {
  buildFileTree,
  defaultExpandedFolders,
  expansionChainForFile,
} from '../lib/graphModel';
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

  const localOnly = useMemo(() => {
    const serverReady = tree.length > 0 && project?.lastImportedAt;
    return !!localManifest && !serverReady;
  }, [tree, localManifest, project?.lastImportedAt]);

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

  // Scroll the focused file row into view after render.
  const focusRowRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (focusRowRef.current) {
      focusRowRef.current.scrollIntoView({ block: 'nearest' });
    }
  });

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
            Browser preview only — enter your folder path above and click <strong>Link folder on disk</strong>{' '}
            for links and PHPStan (no upload).
          </p>
        )}

        <ScreenState
          status={status === 'ready' && treeNodes.length === 0 && !localManifest ? 'empty' : status === 'error' ? 'error' : treeNodes.length || localManifest ? 'ready' : status}
          errorMessage={errorMessage}
          emptyHint="No files yet — link a folder above, or switch project in the header."
        >
          <div className="split" data-animate>
            <div className="panel">
              <div className="panel__head">
                <h2 className="panel__title">Node tree</h2>
                <span className="panel__hint">
                  {allFilePaths.length.toLocaleString()} files
                  {localOnly ? ' · local preview' : ' · from API'}
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
                      className={`tree__row${isSelected ? ' tree__row--selected' : ''}`}
   