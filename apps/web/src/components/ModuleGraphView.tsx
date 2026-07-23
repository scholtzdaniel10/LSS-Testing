/**
 * ModuleGraphView — DOM-only dependency explorer (no force-graph / canvas).
 * Module columns + folder drill-down + neighbourhood focus.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GraphEdge } from '../api/client';
import {
  buildGraphView,
  buildNeighbourMap,
  buildStackProfile,
  collapseFolder,
  expansionChainForFile,
  neighbourhoodWithin,
  searchGraphNodes,
  type ForceGraphNode,
} from '../lib/graphModel';
import { folderKeyOf } from '../lib/radialModel';

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

/** Hard cap — never mount force-graph above this; list view only. */
export const FORCE_GRAPH_NODE_CAP = 80;

type Props = {
  edges: GraphEdge[];
  errorFiles: Map<string, number>;
  files?: string[];
  frameworks?: string[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  onOpenFile: (path: string) => void;
  focusPath?: string | null;
};

const ModuleGraphView: React.FC<Props> = ({
  edges,
  errorFiles,
  files = [],
  frameworks = [],
  selected,
  onSelect,
  onOpenFile,
  focusPath,
}) => {
  const searchRef = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showExternal, setShowExternal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [focusDepth, setFocusDepth] = useState(2);
  const [activeModule, setActiveModule] = useState<string | null>(null);
  const lastClick = useRef<{ id: string; at: number } | null>(null);

  const stackProfile = useMemo(() => buildStackProfile(frameworks), [frameworks]);

  useEffect(() => {
    if (!focusPath) return;
    const chain = expansionChainForFile(focusPath);
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const f of chain) next.add(f);
      return next;
    });
    setActiveModule(folderKeyOf(focusPath));
  }, [focusPath]);

  const view = useMemo(
    () => buildGraphView(edges, files, errorFiles, expanded, showExternal, stackProfile),
    [edges, files, errorFiles, expanded, showExternal, stackProfile],
  );

  const neighbours = useMemo(() => buildNeighbourMap(view.links), [view.links]);

  const focusNeighbourhood = useMemo(() => {
    if (!selected) return null;
    return neighbourhoodWithin(selected, neighbours, focusDepth);
  }, [selected, neighbours, focusDepth]);

  const nodeById = useMemo(
    () => new Map(view.nodes.map((n) => [n.id, n])),
    [view.nodes],
  );

  const searchHits = useMemo(
    () => searchGraphNodes(view.nodes, searchQuery),
    [view.nodes, searchQuery],
  );

  const selectedNode = selected ? nodeById.get(selected) ?? null : null;

  const modules = useMemo(() => {
    const map = new Map<string, ForceGraphNode[]>();
    for (const n of view.nodes) {
      const key = n.external ? 'external' : n.folder;
      const arr = map.get(key) ?? [];
      arr.push(n);
      map.set(key, arr);
    }
    return [...map.entries()]
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .map(([key, nodes]) => ({
        key,
        label: key === 'external' ? 'external' : `${key}/`,
        nodes: nodes.sort((a, b) => (b.errors - a.errors) || (b.degree - a.degree) || a.id.localeCompare(b.id)),
      }));
  }, [view.nodes]);

  const visibleModules = useMemo(() => {
    if (!activeModule) return modules;
    return modules.filter((m) => m.key === activeModule);
  }, [modules, activeModule]);

  const isVisible = useCallback(
    (id: string) => !focusNeighbourhood || focusNeighbourhood.has(id),
    [focusNeighbourhood],
  );

  const pickSearchResult = useCallback(
    (node: ForceGraphNode) => {
      setSearchQuery('');
      setSearchOpen(false);
      if (node.kind === 'folder' && node.folderPath) {
        setExpanded((prev) => new Set(prev).add(node.folderPath!));
      }
      onSelect(node.id);
      setActiveModule(node.external ? 'external' : node.folder);
    },
    [onSelect],
  );

  const activateNode = useCallback(
    (node: ForceGraphNode) => {
      const now = Date.now();
      const prev = lastClick.current;
      if (prev && prev.id === node.id && now - prev.at < 350) {
        lastClick.current = null;
        if (node.kind === 'file' && !node.external) onOpenFile(node.id);
        return;
      }
      lastClick.current = { id: node.id, at: now };
      if (node.kind === 'folder' && node.folderPath) {
        setExpanded((prev) => new Set(prev).add(node.folderPath!));
      }
      onSelect(node.id);
      setActiveModule(node.external ? 'external' : node.folder);
    },
    [onOpenFile, onSelect],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onSelect(null);
        setSearchOpen(false);
        return;
      }
      if (e.key === '/' && document.activeElement !== searchRef.current) {
        e.preventDefault();
        searchRef.current?.focus();
        setSearchOpen(true);
        return;
      }
      if (e.key === 'Enter' && searchHits[0] && document.activeElement === searchRef.current) {
        e.preventDefault();
        pickSearchResult(searchHits[0]);
      }
    },
    [onSelect, pickSearchResult, searchHits],
  );

  const expandedList = useMemo(() => [...expanded].sort(), [expanded]);
  const neighbourCount = focusNeighbourhood ? Math.max(0, focusNeighbourhood.size - 1) : 0;

  return (
    <div className="graph-wrap module-graph" onKeyDown={handleKeyDown} tabIndex={0} style={{ contain: 'layout style' }}>
      <div className="graph-toolbar">
        <label className="graph-toolbar__toggle">
          <input type="checkbox" checked={showExternal} onChange={(e) => setShowExternal(e.target.checked)} />
          Show external packages
          {!showExternal && view.hiddenExternal > 0 ? (
            <span className="graph-toolbar__count"> ({view.hiddenExternal} hidden)</span>
          ) : null}
        </label>

        <div className="graph-search">
          <input
            ref={searchRef}
            type="search"
            className="graph-search__input"
            placeholder="Find file or folder… (/)"
            value={searchQuery}
            aria-label="Search graph nodes"
            aria-expanded={searchOpen && searchHits.length > 0}
            aria-controls="graph-search-results"
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setSearchOpen(true);
            }}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => window.setTimeout(() => setSearchOpen(false), 150)}
          />
          {searchOpen && searchQuery.trim() && searchHits.length > 0 && (
            <ul id="graph-search-results" className="graph-search__results" role="listbox">
              {searchHits.map((node) => (
                <li key={node.id}>
                  <button
                    type="button"
                    role="option"
                    className="graph-search__hit"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickSearchResult(node)}
                  >
                    <span className="graph-search__hit-name">
                      {node.kind === 'folder' ? `${node.folderPath}/` : node.id}
                    </span>
                    <span className="graph-search__hit-meta">
                      {node.kind}
                      {node.degree > 0 ? ` · ${node.degree} links` : ''}
                      {node.errors > 0 ? ` · ${node.errors} err` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <span className="graph-toolbar__spacer" />
        <span className="graph-toolbar__stat">
          {view.folderCount} folders · {view.fileNodeCount} files · list view (no canvas)
        </span>
        {expanded.size > 0 && (
          <button type="button" className="graph-toolbar__btn" onClick={() => setExpanded(new Set())}>
            Collapse all
          </button>
        )}
        {activeModule && (
          <button type="button" className="graph-toolbar__btn" onClick={() => setActiveModule(null)}>
            All modules
          </button>
        )}
      </div>

      {expandedList.length > 0 && (
        <div className="graph-breadcrumbs">
          {expandedList.map((f) => (
            <button
              key={f}
              type="button"
              className="graph-chip"
              onClick={() => setExpanded((prev) => collapseFolder(prev, f))}
              title={`Collapse ${f}/`}
            >
              {f}/ <span aria-hidden="true">×</span>
            </button>
          ))}
        </div>
      )}

      {selectedNode && (
        <div className="graph-focus-bar" aria-live="polite">
          <div className="graph-focus-bar__main">
            <span className="graph-focus-bar__kind">{selectedNode.kind}</span>
            <span className="graph-focus-bar__path mono" title={selectedNode.id}>
              {selectedNode.kind === 'folder' ? `${selectedNode.folderPath}/` : selectedNode.id}
            </span>
            <span className="graph-focus-bar__meta">
              {selectedNode.degree} link{selectedNode.degree === 1 ? '' : 's'}
              {selectedNode.errors > 0 ? ` · ${selectedNode.errors} err` : ''}
              {focusNeighbourhood ? ` · ${neighbourCount} within ${focusDepth} hop${focusDepth === 1 ? '' : 's'}` : ''}
            </span>
          </div>
          <label className="graph-focus-bar__depth">
            Depth
            <input
              type="range"
              min={1}
              max={3}
              step={1}
              value={focusDepth}
              aria-label="Neighbourhood depth"
              onChange={(e) => setFocusDepth(Number(e.target.value))}
            />
            <span className="graph-focus-bar__depth-val">{focusDepth}</span>
          </label>
          <div className="graph-focus-bar__actions">
            {selectedNode.kind === 'file' && !selectedNode.external && (
              <button type="button" className="graph-toolbar__btn" onClick={() => onOpenFile(selectedNode.id)}>
                Open in IDE
              </button>
            )}
            <button type="button" className="graph-toolbar__btn" onClick={() => onSelect(null)}>
              Clear
            </button>
          </div>
        </div>
      )}

      <div className="module-map__grid module-graph__grid">
        {visibleModules.map((mod) => (
          <section key={mod.key} className="module-map__column" style={{ contain: 'content' }}>
            <button
              type="button"
              className="module-map__column-head"
              onClick={() => setActiveModule(activeModule === mod.key ? null : mod.key)}
              style={{ borderLeftColor: SERIES[mod.key] ?? SERIES.other }}
            >
              <span className="module-map__column-title">{mod.label}</span>
              <span className="module-map__column-meta">{mod.nodes.length} nodes</span>
            </button>
            <ul className="module-map__file-list">
              {mod.nodes.map((node) => {
                if (!isVisible(node.id)) return null;
                const dim = focusNeighbourhood && selected && node.id !== selected && !neighbours.get(selected)?.has(node.id);
                const isSel = node.id === selected;
                return (
                  <li key={node.id}>
                    <button
                      type="button"
                      className={`module-map__file${isSel ? ' module-map__file--selected' : ''}${dim ? ' module-map__file--dim' : ''}`}
                      onClick={() => activateNode(node)}
                      onDoubleClick={() => {
                        if (node.kind === 'file' && !node.external) onOpenFile(node.id);
                      }}
                      title={node.id}
                    >
                      <span
                        className="module-map__dot"
                        style={{
                          background: node.errors > 0
                            ? 'var(--status-critical)'
                            : SERIES[node.folder] ?? SERIES.other,
                        }}
                        aria-hidden="true"
                      />
                      <span className="module-map__file-name">
                        {node.kind === 'folder' ? `${node.name} (${node.fileCount})` : node.name}
                      </span>
                      {node.degree > 0 && <span className="tree__badge">{node.degree}</span>}
                      {node.errors > 0 && <span className="tree__badge tree__badge--err">{node.errors}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      <p className="graph-wrap__hint">
        Click a <strong>folder</strong> to drill in · <strong>double-click</strong> a file to open in your IDE ·{' '}
        <kbd>/</kbd> to search
      </p>
    </div>
  );
};

export default ModuleGraphView;
