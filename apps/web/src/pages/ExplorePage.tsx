import { useEffect, useMemo, useRef, useState } from 'react';
import { useEntrance } from '../lib/anim';
import ImportDropzone from '../components/ImportDropzone';
import ScreenState from '../components/ScreenState';
import { useProject } from '../state/ProjectContext';
import { loadEditorSettings, openInIde } from '../types';

const folderOf = (path: string) => {
  const top = path.split('/')[0] ?? 'other';
  if (['app', 'application', 'routes', 'resources', 'database', 'src', 'system'].includes(top)) return top;
  return 'other';
};

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

const GRAPH_W = 960;
const GRAPH_H = 460;

type GraphNode = {
  id: string;
  label: string;
  folder: string;
  x: number;
  y: number;
  inDegree: number;
  errors: number;
};

/** Circle layout — do not apply CSS scale to SVG <g> (breaks translate). */
function layoutCircle(ids: string[], edges: { from: string; to: string }[], errorFiles: Map<string, number>): GraphNode[] {
  const n = ids.length;
  const cx = GRAPH_W / 2;
  const cy = GRAPH_H / 2;
  const radius = Math.min(GRAPH_W, GRAPH_H) * 0.36;
  return ids.map((id, i) => {
    const angle = n === 1 ? -Math.PI / 2 : (i / n) * Math.PI * 2 - Math.PI / 2;
    return {
      id,
      label: id.split('/').pop() ?? id,
      folder: folderOf(id),
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
      inDegree: edges.filter((e) => e.to === id).length,
      errors: errorFiles.get(id) ?? 0,
    };
  });
}

const ExplorePage: React.FC = () => {
  const ref = useEntrance();
  const { tree, graphEdges, errors, localManifest, status, errorMessage, usage, project } = useProject();
  const [selected, setSelected] = useState<string | null>(null);
  const [ideHint, setIdeHint] = useState<string | null>(null);
  const graphRef = useRef<SVGSVGElement>(null);

  const openFile = (path: string, line = 1) => {
    setSelected(path);
    const ok = openInIde(loadEditorSettings(), path, line, project?.name);
    setIdeHint(
      ok
        ? null
        : 'Set Local project root in Settings to the folder you imported (e.g. C:\\Users\\Jean\\Documents\\LSS-Testing\\LSS-Testing).',
    );
  };

  const treeRows = useMemo(() => {
    const serverReady = tree.length > 0 && project?.lastImportedAt;
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
      if (!edge.to.startsWith('pkg:') && !edge.to.startsWith('php:')) {
        linkCount.set(edge.to, (linkCount.get(edge.to) ?? 0) + 1);
      }
    }
    return source.slice(0, 400).map((path) => ({
      path,
      depth: path.split('/').length - 1,
      folder: folderOf(path),
      links: linkCount.get(path) ?? 0,
      errors: errorCount.get(path) ?? 0,
    }));
  }, [tree, localManifest, errors, graphEdges, project?.lastImportedAt]);

  const nodes = useMemo(() => {
    const ids = new Set<string>();
    for (const e of graphEdges) {
      if (!e.from.startsWith('pkg:') && !e.from.startsWith('php:')) ids.add(e.from);
      if (!e.to.startsWith('pkg:') && !e.to.startsWith('php:')) ids.add(e.to);
    }
    // Also show tree files so a project with no edges still has a graph.
    for (const row of treeRows.slice(0, 60)) {
      ids.add(row.path);
    }
    const errorFiles = new Map<string, number>();
    for (const e of errors) {
      errorFiles.set(e.file, (errorFiles.get(e.file) ?? 0) + 1);
    }
    return layoutCircle([...ids].slice(0, 80), graphEdges, errorFiles);
  }, [graphEdges, errors, treeRows]);

  useEffect(() => {
    // Fade-in via opacity only — never CSS transform/scale on SVG groups.
    const el = graphRef.current;
    if (!el) return;
    el.querySelectorAll<SVGGElement>('.graph-node').forEach((node, i) => {
      node.style.opacity = '0';
      window.setTimeout(() => {
        node.style.transition = 'opacity 280ms ease-out';
        node.style.opacity = '1';
      }, 40 + i * 25);
    });
  }, [nodes]);

  const nodeById = (id: string) => nodes.find((n) => n.id === id);

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

        <ScreenState
          status={status === 'ready' && treeRows.length === 0 && !localManifest ? 'empty' : status === 'error' ? 'error' : treeRows.length || localManifest ? 'ready' : status}
          errorMessage={errorMessage}
          emptyHint="No files yet — drop a folder above, or seed lexpro-portal on the API."
        >
          <div className="split" data-animate>
            <div className="panel">
              <div className="panel__head">
                <h2 className="panel__title">Node tree</h2>
                <span className="panel__hint">
                  {treeRows.length.toLocaleString()} shown
                  {localManifest ? ' · from local cache' : ' · from API'}
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
                <span className="panel__hint">{nodes.length} nodes · click opens IDE</span>
              </div>
              {nodes.length === 0 ? (
                <p className="page__subtitle">No graph yet — run Re-scan after import.</p>
              ) : (
                <svg ref={graphRef} viewBox={`0 0 ${GRAPH_W} ${GRAPH_H}`} width="100%" role="img" aria-label="Dependency graph">
                  {graphEdges
                    .filter((e) => nodeById(e.from) && nodeById(e.to))
                    .slice(0, 200)
                    .map((e) => {
                      const a = nodeById(e.from)!;
                      const b = nodeById(e.to)!;
                      return (
                        <line
                          key={`${e.from}->${e.to}:${e.line ?? 0}`}
                          x1={a.x}
                          y1={a.y}
                          x2={b.x}
                          y2={b.y}
                          stroke="var(--line-2)"
                          strokeWidth={1.5}
                          opacity={0.85}
                        />
                      );
                    })}
                  {nodes.map((n) => (
                    <g
                      key={n.id}
                      className="graph-node"
                      transform={`translate(${n.x}, ${n.y})`}
                      style={{ cursor: 'pointer' }}
                      onClick={() => openFile(n.id)}
                    >
                      <circle
                        r={8 + Math.min(n.inDegree, 8)}
                        fill={SERIES[n.folder] ?? SERIES.other}
                        stroke={n.errors > 0 ? 'var(--status-critical)' : selected === n.id ? 'var(--accent)' : 'var(--line-1)'}
                        strokeWidth={n.errors > 0 || selected === n.id ? 2.5 : 1}
                      />
                      <text y={22} textAnchor="middle" fill="var(--ink-2)" fontSize="11">
                        {n.label}
                      </text>
                    </g>
                  ))}
                </svg>
              )}
              {ideHint && (
                <p role="status" className="field__hint" style={{ marginTop: 8 }}>
                  {ideHint}
                </p>
              )}
              {selected && (
                <p className="mono" style={{ marginTop: 8, fontSize: 'var(--text-sm)' }}>
                  Selected: {selected}
                </p>
              )}
            </div>
          </div>
        </ScreenState>
      </div>
    </div>
  );
};

export default ExplorePage;
