/**
 * CodebaseModuleMap — lightweight DOM module columns (replaces radial SVG).
 * No canvas, no SVG arcs/edges, no continuous animation.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GraphEdge, DiagnosticFinding, TreeFile } from '../api/client';
import {
  buildModuleGroups,
  neighbourPaths,
  type ModuleGroup,
} from '../lib/moduleMapModel';
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

export type CodebaseModuleMapProps = {
  edges: GraphEdge[];
  findings: DiagnosticFinding[];
  files: TreeFile[];
  focusParam: string | null;
  onFocusTree: (path: string) => void;
};

const CodebaseModuleMap: React.FC<CodebaseModuleMapProps> = ({
  edges,
  findings,
  files,
  focusParam,
  onFocusTree,
}) => {
  const [selected, setSelected] = useState<string | null>(focusParam ?? null);
  const [expandedModule, setExpandedModule] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const focusRowRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setSelected(focusParam ?? null);
    if (focusParam) {
      setExpandedModule(folderKeyOf(focusParam));
    }
  }, [focusParam]);

  useEffect(() => {
    focusRowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selected, expandedModule]);

  const errorFiles = useMemo(() => {
    const s = new Set<string>();
    for (const f of findings) {
      if (f.severity === 'error') s.add(f.file);
    }
    return s;
  }, [findings]);

  const allPaths = useMemo(() => files.map((f) => f.path), [files]);

  const layout = useMemo(
    () => buildModuleGroups(allPaths, edges, errorFiles),
    [allPaths, edges, errorFiles],
  );

  const neighbours = useMemo(
    () => (selected ? neighbourPaths(selected, edges) : []),
    [selected, edges],
  );

  const q = filter.trim().toLowerCase();
  const modules = useMemo(() => {
    if (!q) return layout.modules;
    return layout.modules
      .map((m) => ({
        ...m,
        files: m.files.filter((f) => f.path.toLowerCase().includes(q)),
      }))
      .filter((m) => m.files.length > 0 || m.label.toLowerCase().includes(q));
  }, [layout.modules, q]);

  const pickFile = useCallback(
    (path: string) => {
      setSelected(path);
      onFocusTree(path);
    },
    [onFocusTree],
  );

  const toggleModule = useCallback((key: string) => {
    setExpandedModule((prev) => (prev === key ? null : key));
  }, []);

  if (allPaths.length === 0) {
    return (
      <p className="panel__hint" style={{ padding: 'var(--sp-4)' }}>
        No files to display.
      </p>
    );
  }

  return (
    <div className="module-map" style={{ contain: 'layout style' }}>
      <div className="module-map__toolbar">
        <span className="panel__hint">
          {layout.totalFiles.toLocaleString()} files · {layout.modules.length} modules
          {layout.capped ? ' · showing top files per module' : ''}
        </span>
        <input
          type="search"
          className="module-map__search"
          placeholder="Filter files…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter module map"
        />
      </div>

      <div className="module-map__grid" role="list" aria-label="Codebase modules">
        {modules.map((mod) => (
          <ModuleColumn
            key={mod.key}
            mod={mod}
            expanded={expandedModule === mod.key || !!q}
            selected={selected}
            focusRowRef={focusRowRef}
            onToggle={() => toggleModule(mod.key)}
            onPick={pickFile}
          />
        ))}
      </div>

      {selected && (
        <div className="module-map__detail" role="status" aria-label="Selected file">
          <span className="mono" style={{ color: 'var(--neon-cyan)' }}>{selected}</span>
          {errorFiles.has(selected) && (
            <span style={{ marginLeft: 8, color: 'var(--status-critical)' }}>has errors</span>
          )}
          {neighbours.length > 0 && (
            <div className="module-map__neighbours">
              <span className="panel__hint">{neighbours.length} direct links:</span>
              <ul>
                {neighbours.slice(0, 24).map((n) => (
                  <li key={n}>
                    <button type="button" className="module-map__link" onClick={() => pickFile(n)}>
                      {n}
                    </button>
                  </li>
                ))}
                {neighbours.length > 24 && (
                  <li className="panel__hint">…and {neighbours.length - 24} more</li>
                )}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

type ColumnProps = {
  mod: ModuleGroup;
  expanded: boolean;
  selected: string | null;
  focusRowRef: React.RefObject<HTMLButtonElement | null>;
  onToggle: () => void;
  onPick: (path: string) => void;
};

function ModuleColumn({ mod, expanded, selected, focusRowRef, onToggle, onPick }: ColumnProps) {
  const color = SERIES[mod.key] ?? SERIES.other;
  const hidden = mod.fileCount - mod.files.length;

  return (
    <section className="module-map__column" role="listitem" style={{ contain: 'content' }}>
      <button
        type="button"
        className="module-map__column-head"
        onClick={onToggle}
        aria-expanded={expanded}
        style={{ borderLeftColor: color }}
      >
        <span className="module-map__column-title">{mod.label}</span>
        <span className="module-map__column-meta">
          {mod.fileCount} files
          {mod.errorCount > 0 ? ` · ${mod.errorCount} err` : ''}
          {mod.totalLinks > 0 ? ` · ${mod.totalLinks} links` : ''}
        </span>
      </button>
      {expanded && (
        <ul className="module-map__file-list">
          {mod.files.map((f) => {
            const isSel = f.path === selected;
            return (
              <li key={f.path}>
                <button
                  type="button"
                  ref={isSel ? focusRowRef : undefined}
                  className={`module-map__file${isSel ? ' module-map__file--selected' : ''}`}
                  onClick={() => onPick(f.path)}
                  title={f.path}
                >
                  <span className="module-map__dot" style={{ background: color }} aria-hidden="true" />
                  <span className="module-map__file-name">{f.name}</span>
                  {f.errors > 0 && <span className="tree__badge tree__badge--err">{f.errors} err</span>}
                  {f.links > 0 && <span className="tree__badge">{f.links}</span>}
                </button>
              </li>
            );
          })}
          {hidden > 0 && (
            <li className="panel__hint" style={{ padding: '4px 8px' }}>
              +{hidden} more — use search or node tree
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

export default CodebaseModuleMap;
