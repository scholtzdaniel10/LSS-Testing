import ForceGraph2D, { type ForceGraphMethods, type LinkObject, type NodeObject } from 'react-force-graph-2d';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GraphEdge } from '../api/client';
import { buildGraphView, collapseFolder, expansionChainForFile, type ForceGraphLink, type ForceGraphNode } from '../lib/graphModel';

type GraphNode = ForceGraphNode & NodeObject;
type GraphLink = ForceGraphLink & LinkObject;

function linkEndpointId(endpoint: string | GraphNode): string {
  return typeof endpoint === 'object' ? endpoint.id : endpoint;
}

type Props = {
  edges: GraphEdge[];
  errorFiles: Map<string, number>;
  files?: string[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  onOpenFile: (path: string) => void;
  /** When set, auto-expands the folder chain for this path and centres on it. */
  focusPath?: string | null;
};

const GRAPH_HEIGHT = 460;

function readCssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

const DependencyGraph: React.FC<Props> = ({ edges, errorFiles, files = [], selected, onSelect, onOpenFile, focusPath }) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<ForceGraphMethods<GraphNode, GraphLink> | undefined>(undefined);
  const [width, setWidth] = useState(640);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showExternal, setShowExternal] = useState(false);

  // When focusPath arrives (from deep-link), expand its full folder chain once.
  useEffect(() => {
    if (!focusPath) return;
    const chain = expansionChainForFile(focusPath);
    if (chain.size === 0) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const f of chain) next.add(f);
      return next;
    });
  }, [focusPath]);

  const theme = useMemo(
    () => ({
      accent: readCssVar('--accent', '#ff4b4b'),
      line1: readCssVar('--line-1', '#3b3937'),
      line2: readCssVar('--line-2', '#4a4745'),
      line3: readCssVar('--line-3', '#625d5b'),
      ink2: readCssVar('--ink-2', '#cccac9'),
      ink3: readCssVar('--ink-3', '#85837e'),
      critical: readCssVar('--status-critical', '#d34343'),
      page: readCssVar('--surface-page', '#252423'),
      raised: readCssVar('--surface-raised', '#302e2c'),
      mono: readCssVar('--font-mono', 'monospace'),
    }),
    [],
  );

  const view = useMemo(
    () => buildGraphView(edges, files, errorFiles, expanded, showExternal),
    [edges, files, errorFiles, expanded, showExternal],
  );

  const graphData = useMemo(
    () => ({ nodes: view.nodes.map((n) => ({ ...n })), links: view.links.map((l) => ({ ...l })) }),
    [view],
  );

  const neighbours = useMemo(() => {
    const map = new Map<string, Set<string>>();
    const add = (a: string, b: string) => {
      if (!map.has(a)) map.set(a, new Set());
      map.get(a)!.add(b);
    };
    for (const l of graphData.links) {
      const s = linkEndpointId(l.source as string | GraphNode);
      const t = linkEndpointId(l.target as string | GraphNode);
      add(s, t);
      add(t, s);
    }
    return map;
  }, [graphData]);

  const focusId = hoverId ?? selected;

  const isDimmed = useCallback(
    (id: string) => {
      if (!focusId) return false;
      if (id === focusId) return false;
      return !(neighbours.get(focusId)?.has(id) ?? false);
    },
    [focusId, neighbours],
  );

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(320, Math.floor(entry.contentRect.width))));
    ro.observe(el);
    setWidth(Math.max(320, Math.floor(el.clientWidth)));
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const g = graphRef.current;
    if (!g) return;
    g.d3Force('charge')?.strength(-160);
    g.d3Force('link')?.distance(56);
  }, [graphData]);

  // Centre on focusPath file node once the graph has it as a visible node.
  useEffect(() => {
    if (!focusPath) return;
    const node = graphData.nodes.find((n) => n.id === focusPath);
    if (!node || node.x == null || node.y == null) return;
    graphRef.current?.centerAt(node.x, node.y, 500);
    graphRef.current?.zoom(Math.max(2.5, graphRef.current.zoom()), 500);
  }, [focusPath, graphData]);

  const nodeRadius = useCallback((node: GraphNode) => {
    if (node.kind === 'folder') return 10 + Math.min(Math.sqrt(node.fileCount) * 2.4, 16);
    if (node.external) return 6;
    return 8 + Math.min(node.inDegree, 6);
  }, []);

  const labelMetrics = useCallback(
    (node: GraphNode, globalScale: number, ctx: CanvasRenderingContext2D) => {
      const r = nodeRadius(node);
      const fontSize = Math.max(9, 11 / globalScale);
      ctx.font = `${node.kind === 'folder' ? '600 ' : ''}${fontSize}px ${theme.mono}`;
      const label = node.kind === 'folder' ? `${node.name} ${node.fileCount}` : node.name;
      const textWidth = ctx.measureText(label).width;
      return { r, fontSize, textWidth, label, labelTop: (node.y ?? 0) + r + 2, labelHeight: fontSize + 8, padX: 6, padY: 4 };
    },
    [nodeRadius, theme.mono],
  );

  const linkColor = useCallback(
    (link: GraphLink) => {
      if (!focusId) return link.externalTarget ? theme.line3 : theme.line2;
      const src = linkEndpointId(link.source as string | GraphNode);
      const tgt = linkEndpointId(link.target as string | GraphNode);
      if (src === focusId || tgt === focusId) return theme.accent;
      return link.externalTarget ? theme.line3 : theme.line2;
    },
    [focusId, theme.accent, theme.line2, theme.line3],
  );

  const linkWidth = useCallback(
    (link: GraphLink) => {
      const base = Math.min(0.8 + (link.weight ?? 1) * 0.35, 4);
      if (!focusId) return base;
      const src = linkEndpointId(link.source as string | GraphNode);
      const tgt = linkEndpointId(link.target as string | GraphNode);
      return src === focusId || tgt === focusId ? Math.max(base, 2.5) : 0.7;
    },
    [focusId],
  );

  const centerOn = useCallback((node: GraphNode) => {
    const g = graphRef.current;
    if (!g || node.x == null || node.y == null) return;
    g.centerAt(node.x, node.y, 500);
    g.zoom(Math.max(2, g.zoom()), 500);
  }, []);

  const activateNode = useCallback(
    (node: GraphNode) => {
      onSelect(node.id);
      if (node.kind === 'folder' && node.folderPath) {
        setExpanded((prev) => new Set(prev).add(node.folderPath!));
        return;
      }
      if (node.external) {
        centerOn(node);
        return;
      }
      onOpenFile(node.id);
    },
    [centerOn, onOpenFile, onSelect],
  );

  const paintNode = useCallback(
    (node: GraphNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const r = nodeRadius(node);
      const dim = isDimmed(node.id);
      const fill =
        node.id === selected
          ? theme.accent
          : node.errors > 0
            ? theme.critical
            : node.external
              ? theme.raised
              : node.color;

      ctx.globalAlpha = dim ? 0.22 : 1;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.fillStyle = fill;
      ctx.fill();

      if (node.external) {
        ctx.save();
        ctx.setLineDash([2, 2]);
        ctx.strokeStyle = node.id === focusId ? theme.ink2 : theme.line3;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
      } else if (node.kind === 'folder') {
        // A second ring marks folders as expandable "containers".
        ctx.strokeStyle = node.id === focusId ? theme.ink2 : theme.line1;
        ctx.lineWidth = node.id === focusId ? 2 : 1;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, r - 3, 0, 2 * Math.PI);
        ctx.strokeStyle = theme.page;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else {
        ctx.strokeStyle = node.id === focusId ? theme.ink2 : theme.line1;
        ctx.lineWidth = node.id === focusId ? 2 : 1;
        ctx.stroke();
      }

      if (globalScale >= 0.5 && !dim) {
        const { labelTop, label } = labelMetrics(node, globalScale, ctx);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = node.id === focusId ? theme.ink2 : 'rgba(204, 202, 201, 0.8)';
        ctx.fillText(label, x, labelTop);
      }
      ctx.globalAlpha = 1;
    },
    [focusId, isDimmed, labelMetrics, nodeRadius, selected, theme],
  );

  const paintPointerArea = useCallback(
    (node: GraphNode, color: string, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const { r, textWidth, labelTop, labelHeight, padX, padY } = labelMetrics(node, globalScale, ctx);
      const hitR = Math.max(18, r + 12);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, hitR, 0, 2 * Math.PI);
      ctx.fill();
      if (globalScale >= 0.5) {
        ctx.fillRect(x - textWidth / 2 - padX, labelTop - padY, textWidth + padX * 2, labelHeight);
      }
    },
    [labelMetrics],
  );

  const nodeTooltip = useCallback((node: GraphNode) => {
    if (node.kind === 'folder') {
      return `${node.folderPath}/ · ${node.fileCount} file${node.fileCount === 1 ? '' : 's'}${node.errors > 0 ? ` · ${node.errors} errors` : ''} · click to expand`;
    }
    if (node.external) {
      const kind = node.id.startsWith('php:') ? 'class/namespace' : 'package';
      return `${node.name} — external ${kind} · not a file`;
    }
    const err = node.errors > 0 ? ` · ${node.errors} error${node.errors === 1 ? '' : 's'}` : '';
    return `${node.id} · ${node.degree} link${node.degree === 1 ? '' : 's'}${err} · click to open in IDE`;
  }, []);

  const expandedList = useMemo(() => [...expanded].sort(), [expanded]);

  return (
    <div ref={wrapRef} className="graph-wrap graph-wrap--force">
      <div className="graph-toolbar">
        <label className="graph-toolbar__toggle">
          <input type="checkbox" checked={showExternal} onChange={(e) => setShowExternal(e.target.checked)} />
          Show external packages
          {!showExternal && view.hiddenExternal > 0 ? (
            <span className="graph-toolbar__count"> ({view.hiddenExternal} hidden)</span>
          ) : null}
        </label>
        <span className="graph-toolbar__spacer" />
        <span className="graph-toolbar__stat">
          {view.folderCount} folders · {view.fileNodeCount} files
        </span>
        {expanded.size > 0 && (
          <button type="button" className="graph-toolbar__btn" onClick={() => setExpanded(new Set())}>
            Collapse all
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

      <ForceGraph2D
        ref={graphRef}
        width={width}
        height={GRAPH_HEIGHT}
        graphData={graphData}
        backgroundColor={theme.page}
        nodeId="id"
        nodeLabel={nodeTooltip}
        linkColor={linkColor}
        linkWidth={linkWidth}
        linkDirectionalArrowLength={3.5}
        linkDirectionalArrowRelPos={1}
        linkCurvature={0.12}
        cooldownTicks={100}
        warmupTicks={60}
        d3AlphaDecay={0.022}
        d3VelocityDecay={0.35}
        enableNodeDrag
        enableZoomInteraction
        enablePanInteraction
        enablePointerInteraction
        showPointerCursor={(obj) => !!obj}
        onEngineStop={() => {
          graphRef.current?.zoomToFit(400, 40);
          graphRef.current?.pauseAnimation();
        }}
        linkHoverPrecision={0}
        onNodeClick={activateNode}
        onNodeHover={(node) => setHoverId(node?.id ?? null)}
        onBackgroundClick={() => onSelect(null)}
        nodeCanvasObjectMode={() => 'replace'}
        nodeCanvasObject={(node, ctx, globalScale) => paintNode(node, ctx, globalScale)}
        nodePointerAreaPaint={paintPointerArea}
        linkPointerAreaPaint={() => {
          /* links are visual only — avoid stealing clicks from node labels */
        }}
      />
      <p className="graph-wrap__hint">
        Click a <strong>folder</strong> to drill in · click a <strong>file</strong> to open it in your IDE · hover for
        the full path · dashed ring = external package
      </p>
    </div>
  );
};

export default DependencyGraph;
