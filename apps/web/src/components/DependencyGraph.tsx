import ForceGraph2D, { type ForceGraphMethods, type LinkObject, type NodeObject } from 'react-force-graph-2d';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GraphEdge } from '../api/client';
import { buildForceGraphData, type ForceGraphLink, type ForceGraphNode } from '../lib/graphModel';

type GraphNode = ForceGraphNode & NodeObject;
type GraphLink = ForceGraphLink & LinkObject;

function linkEndpointId(endpoint: string | GraphNode): string {
  return typeof endpoint === 'object' ? endpoint.id : endpoint;
}

type Props = {
  edges: GraphEdge[];
  errorFiles: Map<string, number>;
  extraFileIds?: string[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  onOpenFile: (path: string) => void;
};

const GRAPH_HEIGHT = 460;

function readCssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

const DependencyGraph: React.FC<Props> = ({
  edges,
  errorFiles,
  extraFileIds = [],
  selected,
  onSelect,
  onOpenFile,
}) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<ForceGraphMethods<GraphNode, GraphLink> | undefined>(undefined);
  const [width, setWidth] = useState(640);
  const [hoverId, setHoverId] = useState<string | null>(null);

  const theme = useMemo(
    () => ({
      accent: readCssVar('--accent', '#ff4b4b'),
      line1: readCssVar('--line-1', '#3b3937'),
      line2: readCssVar('--line-2', '#4a4745'),
      line3: readCssVar('--line-3', '#625d5b'),
      ink2: readCssVar('--ink-2', '#cccac9'),
      critical: readCssVar('--status-critical', '#d34343'),
      page: readCssVar('--surface-page', '#252423'),
      raised: readCssVar('--surface-raised', '#302e2c'),
      mono: readCssVar('--font-mono', 'monospace'),
    }),
    [],
  );

  const graphData = useMemo(() => {
    const built = buildForceGraphData(edges, errorFiles, extraFileIds);
    return {
      nodes: built.nodes.map((n) => ({ ...n })),
      links: built.links.map((l) => ({ ...l })),
    };
  }, [edges, errorFiles, extraFileIds]);

  const focusId = hoverId ?? selected;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setWidth(Math.max(320, Math.floor(entry.contentRect.width)));
    });
    ro.observe(el);
    setWidth(Math.max(320, Math.floor(el.clientWidth)));
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const g = graphRef.current;
    if (!g) return;
    g.d3Force('charge')?.strength(-140);
    g.d3Force('link')?.distance(52);
  }, [graphData]);

  const nodeRadius = useCallback((node: GraphNode) => {
    if (node.external) return 6;
    return 8 + Math.min(node.inDegree, 6);
  }, []);

  const labelMetrics = useCallback(
    (node: GraphNode, globalScale: number, ctx: CanvasRenderingContext2D) => {
      const r = nodeRadius(node);
      const fontSize = Math.max(9, 11 / globalScale);
      ctx.font = `${fontSize}px ${theme.mono}`;
      const textWidth = ctx.measureText(node.name).width;
      const padX = 6;
      const padY = 4;
      return {
        r,
        fontSize,
        textWidth,
        labelTop: (node.y ?? 0) + r + 2,
        labelHeight: fontSize + padY * 2,
        padX,
        padY,
      };
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
      if (!focusId) return link.externalTarget ? 1 : 1.5;
      const src = linkEndpointId(link.source as string | GraphNode);
      const tgt = linkEndpointId(link.target as string | GraphNode);
      return src === focusId || tgt === focusId ? 2.5 : 0.8;
    },
    [focusId],
  );

  const activateNode = useCallback(
    (node: GraphNode) => {
      onSelect(node.id);
      if (!node.external) onOpenFile(node.id);
    },
    [onOpenFile, onSelect],
  );

  const paintNode = useCallback(
    (node: GraphNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const r = nodeRadius(node);
      const fill =
        node.id === selected
          ? theme.accent
          : node.errors > 0
            ? theme.critical
            : node.external
              ? theme.raised
              : node.color;

      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.fillStyle = fill;
      ctx.fill();

      ctx.strokeStyle = node.id === focusId ? theme.ink2 : theme.line1;
      ctx.lineWidth = node.id === focusId ? 2 : 1;
      ctx.stroke();

      if (globalScale >= 0.55) {
        // labelMetrics sets ctx.font as a side effect; only labelTop is needed here.
        const { labelTop } = labelMetrics(node, globalScale, ctx);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = node.id === focusId ? theme.ink2 : 'rgba(204, 202, 201, 0.8)';
        ctx.fillText(node.name, x, labelTop);
      }
    },
    [focusId, labelMetrics, nodeRadius, selected, theme],
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

      // Labels are the usual click target — include them in the hit map.
      if (globalScale >= 0.55) {
        ctx.fillRect(x - textWidth / 2 - padX, labelTop - padY, textWidth + padX * 2, labelHeight);
      }
    },
    [labelMetrics],
  );

  return (
    <div ref={wrapRef} className="graph-wrap graph-wrap--force">
      <ForceGraph2D
        ref={graphRef}
        width={width}
        height={GRAPH_HEIGHT}
        graphData={graphData}
        backgroundColor={theme.page}
        nodeId="id"
        nodeLabel=""
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
        onEngineStop={() => graphRef.current?.pauseAnimation()}
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
      <p className="graph-wrap__hint">Drag nodes · scroll to zoom · click a node or its label to open in IDE</p>
    </div>
  );
};

export default DependencyGraph;
