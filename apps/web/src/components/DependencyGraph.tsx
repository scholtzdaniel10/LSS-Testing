import ForceGraph2D, { type ForceGraphMethods, type LinkObject, type NodeObject } from 'react-force-graph-2d';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GraphEdge } from '../api/client';
import {
  buildGraphView,
  buildNeighbourMap,
  buildStackProfile,
  collapseFolder,
  expansionChainForFile,
  graphPerformanceProfile,
  neighbourhoodWithin,
  resolveGraphColor,
  searchGraphNodes,
  type ForceGraphLink,
  type ForceGraphNode,
} from '../lib/graphModel';

type GraphNode = ForceGraphNode & NodeObject;
type GraphLink = ForceGraphLink & LinkObject;

function linkEndpointId(endpoint: string | GraphNode): string {
  return typeof endpoint === 'object' ? endpoint.id : endpoint;
}

type Props = {
  edges: GraphEdge[];
  errorFiles: Map<string, number>;
  files?: string[];
  frameworks?: string[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  onOpenFile: (path: string) => void;
  /** When set, auto-expands the folder chain for this path and centres on it. */
  focusPath?: string | null;
};

const GRAPH_HEIGHT = 480;

/** Cap force-graph canvas backing-store scale (library always uses devicePixelRatio). */
function capCanvasDpr(container: HTMLElement, maxDpr: number): void {
  const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
  for (const canvas of container.querySelectorAll('canvas')) {
    const cssW = parseInt(canvas.style.width, 10) || canvas.clientWidth;
    const cssH = parseInt(canvas.style.height, 10) || canvas.clientHeight;
    if (!cssW || !cssH) continue;
    const targetW = Math.floor(cssW * dpr);
    const targetH = Math.floor(cssH * dpr);
    if (canvas.width === targetW && canvas.height === targetH) continue;
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}

function readCssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

const DependencyGraph: React.FC<Props> = ({
  edges,
  errorFiles,
  files = [],
  frameworks = [],
  selected,
  onSelect,
  onOpenFile,
  focusPath,
}) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const graphRef = useRef<ForceGraphMethods<GraphNode, GraphLink> | undefined>(undefined);
  const hoverIdRef = useRef<string | null>(null);
  const didInitialFit = useRef(false);
  const userAdjustedView = useRef(false);
  const lastClick = useRef<{ id: string; at: number } | null>(null);

  const [width, setWidth] = useState(640);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showExternal, setShowExternal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [focusDepth, setFocusDepth] = useState(2);

  const stackProfile = useMemo(() => buildStackProfile(frameworks), [frameworks]);

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
      ink1: readCssVar('--ink-1', '#f6f4f2'),
      ink2: readCssVar('--ink-2', '#cccac9'),
      ink3: readCssVar('--ink-3', '#85837e'),
      critical: readCssVar('--status-critical', '#d34343'),
      page: readCssVar('--surface-page', '#252423'),
      raised: readCssVar('--surface-raised', '#302e2c'),
      panel: readCssVar('--surface-panel', '#2a2928'),
      mono: readCssVar('--font-mono', 'monospace'),
    }),
    [],
  );

  const resolveColor = useCallback(
    (token: string) => resolveGraphColor(token, (name) => readCssVar(name, token)),
    [],
  );

  const view = useMemo(
    () => buildGraphView(edges, files, errorFiles, expanded, showExternal, stackProfile),
    [edges, files, errorFiles, expanded, showExternal, stackProfile],
  );

  const graphData = useMemo(
    () => ({ nodes: view.nodes.map((n) => ({ ...n })), links: view.links.map((l) => ({ ...l })) }),
    [view],
  );

  const neighbours = useMemo(() => buildNeighbourMap(graphData.links), [graphData.links]);

  const focusNeighbourhood = useMemo(() => {
    if (!selected) return null;
    return neighbourhoodWithin(selected, neighbours, focusDepth);
  }, [selected, neighbours, focusDepth]);

  const nodeCount = graphData.nodes.length;
  const perf = useMemo(() => graphPerformanceProfile(nodeCount), [nodeCount]);
  const denseGraph = nodeCount > 80;

  const requestGraphRedraw = useCallback(() => {
    const g = graphRef.current;
    if (!g) return;
    g.resumeAnimation();
    requestAnimationFrame(() => g.pauseAnimation());
  }, []);

  const resolveFocusId = useCallback(() => hoverIdRef.current ?? selected, [selected]);

  const isHiddenByFocus = useCallback(
    (id: string) => {
      if (!focusNeighbourhood) return false;
      return !focusNeighbourhood.has(id);
    },
    [focusNeighbourhood],
  );

  const isDimmed = useCallback(
    (id: string) => {
      const focusId = resolveFocusId();
      if (isHiddenByFocus(id)) return true;
      if (!focusId) return false;
      if (id === focusId) return false;
      return !(neighbours.get(focusId)?.has(id) ?? false);
    },
    [resolveFocusId, isHiddenByFocus, neighbours],
  );

  const searchHits = useMemo(
    () => searchGraphNodes(graphData.nodes, searchQuery),
    [graphData.nodes, searchQuery],
  );

  const selectedNode = useMemo(
    () => (selected ? graphData.nodes.find((n) => n.id === selected) ?? null : null),
    [graphData.nodes, selected],
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
    didInitialFit.current = false;
    userAdjustedView.current = false;
    hoverIdRef.current = null;
  }, [graphData]);

  useEffect(() => {
    const g = graphRef.current;
    if (!g) return;
    const charge = nodeCount > 200 ? -120 : -160;
    g.d3Force('charge')?.strength(charge);
    g.d3Force('link')?.distance(nodeCount > 200 ? 48 : 56);
  }, [graphData, nodeCount]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const apply = () => capCanvasDpr(el, perf.maxCanvasDpr);
    apply();
    const ro = new ResizeObserver(() => {
      apply();
      requestGraphRedraw();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [perf.maxCanvasDpr, width, requestGraphRedraw]);

  useEffect(() => () => {
    graphRef.current?.pauseAnimation();
  }, []);

  const centerOn = useCallback((node: GraphNode, zoomLevel = 2) => {
    const g = graphRef.current;
    if (!g || node.x == null || node.y == null) return;
    g.centerAt(node.x, node.y, 450);
    g.zoom(Math.max(zoomLevel, g.zoom()), 450);
  }, []);

  const fitGraph = useCallback(() => {
    graphRef.current?.zoomToFit(400, 48);
    userAdjustedView.current = false;
  }, []);

  const zoomBy = useCallback((factor: number) => {
    const g = graphRef.current;
    if (!g) return;
    userAdjustedView.current = true;
    g.zoom(g.zoom() * factor, 250);
  }, []);

  const focusNode = useCallback(
    (node: GraphNode) => {
      if (node.kind === 'folder' && node.folderPath) {
        setExpanded((prev) => new Set(prev).add(node.folderPath!));
      }
      onSelect(node.id);
      requestAnimationFrame(() => centerOn(node, node.kind === 'folder' ? 1.8 : 2.4));
    },
    [centerOn, onSelect],
  );

  useEffect(() => {
    if (!focusPath) return;
    const node = graphData.nodes.find((n) => n.id === focusPath);
    if (!node || node.x == null || node.y == null) return;
    centerOn(node, 2.5);
  }, [focusPath, graphData, centerOn]);

  const openNode = useCallback(
    (node: GraphNode) => {
      if (node.kind === 'folder') return;
      if (node.external) return;
      onOpenFile(node.id);
    },
    [onOpenFile],
  );

  const activateNode = useCallback(
    (node: GraphNode) => {
      const now = Date.now();
      const prev = lastClick.current;
      if (prev && prev.id === node.id && now - prev.at < 350) {
        lastClick.current = null;
        openNode(node);
        return;
      }
      lastClick.current = { id: node.id, at: now };
      focusNode(node);
    },
    [focusNode, openNode],
  );

  const pickSearchResult = useCallback(
    (node: GraphNode) => {
      setSearchQuery('');
      setSearchOpen(false);
      focusNode(node);
    },
    [focusNode],
  );

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

  const shouldDrawLabel = useCallback(
    (node: GraphNode, globalScale: number) => {
      const focusId = resolveFocusId();
      if (isHiddenByFocus(node.id)) return false;
      if (isDimmed(node.id) && node.id !== focusId) return false;

      if (perf.sparseLabels) {
        if (node.id === focusId || node.id === selected) return true;
        if (node.errors > 0) return globalScale >= 0.55;
        if (node.kind === 'folder') return globalScale >= 0.65;
        if (focusId && (neighbours.get(focusId)?.has(node.id) ?? false)) return globalScale >= 0.75;
        return false;
      }

      if (globalScale < 0.45 && denseGraph) return false;
      if (globalScale < 0.35) return false;
      if (denseGraph && node.kind === 'file' && node.id !== focusId && node.id !== selected) {
        return globalScale >= 0.9 || (focusId ? (neighbours.get(focusId)?.has(node.id) ?? false) : false);
      }
      return true;
    },
    [denseGraph, isDimmed, isHiddenByFocus, neighbours, perf.sparseLabels, resolveFocusId, selected],
  );

  const nodeVisible = useCallback(
    (node: GraphNode) => !isHiddenByFocus(node.id),
    [isHiddenByFocus],
  );

  const linkColor = useCallback(
    (link: GraphLink) => {
      const focusId = resolveFocusId();
      const src = linkEndpointId(link.source as string | GraphNode);
      const tgt = linkEndpointId(link.target as string | GraphNode);
      if (isHiddenByFocus(src) || isHiddenByFocus(tgt)) return 'rgba(0,0,0,0)';
      if (!focusId) return link.externalTarget ? theme.line3 : theme.line2;
      if (src === focusId || tgt === focusId) return theme.accent;
      if (isDimmed(src) && isDimmed(tgt)) return theme.line1;
      return link.externalTarget ? theme.line3 : theme.line2;
    },
    [isDimmed, isHiddenByFocus, resolveFocusId, theme.accent, theme.line1, theme.line2, theme.line3],
  );

  const linkWidth = useCallback(
    (link: GraphLink) => {
      const focusId = resolveFocusId();
      const src = linkEndpointId(link.source as string | GraphNode);
      const tgt = linkEndpointId(link.target as string | GraphNode);
      if (isHiddenByFocus(src) || isHiddenByFocus(tgt)) return 0;
      const base = Math.min(0.8 + (link.weight ?? 1) * 0.35, 4);
      if (!focusId) return base;
      return src === focusId || tgt === focusId ? Math.max(base, 2.5) : 0.7;
    },
    [isHiddenByFocus, resolveFocusId],
  );

  const paintNode = useCallback(
    (node: GraphNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      if (isHiddenByFocus(node.id)) return;

      const focusId = resolveFocusId();
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
              : resolveColor(node.color);

      ctx.globalAlpha = dim ? 0.18 : 1;
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

      if (shouldDrawLabel(node, globalScale)) {
        const { labelTop, label, textWidth, labelHeight, padX, padY } = labelMetrics(node, globalScale, ctx);
        ctx.fillStyle = 'rgba(42, 41, 40, 0.88)';
        const bgW = textWidth + padX * 2;
        const bgH = labelHeight;
        const bgX = x - bgW / 2;
        const bgY = labelTop - padY;
        const radius = 3;
        ctx.beginPath();
        ctx.moveTo(bgX + radius, bgY);
        ctx.lineTo(bgX + bgW - radius, bgY);
        ctx.quadraticCurveTo(bgX + bgW, bgY, bgX + bgW, bgY + radius);
        ctx.lineTo(bgX + bgW, bgY + bgH - radius);
        ctx.quadraticCurveTo(bgX + bgW, bgY + bgH, bgX + bgW - radius, bgY + bgH);
        ctx.lineTo(bgX + radius, bgY + bgH);
        ctx.quadraticCurveTo(bgX, bgY + bgH, bgX, bgY + bgH - radius);
        ctx.lineTo(bgX, bgY + radius);
        ctx.quadraticCurveTo(bgX, bgY, bgX + radius, bgY);
        ctx.closePath();
        ctx.fill();

        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = node.id === focusId ? theme.ink1 : theme.ink2;
        ctx.fillText(label, x, labelTop);
      }
      ctx.globalAlpha = 1;
    },
    [isDimmed, isHiddenByFocus, labelMetrics, nodeRadius, resolveColor, resolveFocusId, selected, shouldDrawLabel, theme],
  );

  const paintPointerArea = useCallback(
    (node: GraphNode, color: string, ctx: CanvasRenderingContext2D, globalScale: number) => {
      if (isHiddenByFocus(node.id)) return;
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const { r, textWidth, labelTop, labelHeight, padX, padY } = labelMetrics(node, globalScale, ctx);
      const hitR = Math.max(18, r + 12);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, hitR, 0, 2 * Math.PI);
      ctx.fill();
      if (shouldDrawLabel(node, globalScale)) {
        ctx.fillRect(x - textWidth / 2 - padX, labelTop - padY, textWidth + padX * 2, labelHeight);
      }
    },
    [isHiddenByFocus, labelMetrics, shouldDrawLabel],
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
    return `${node.id} · ${node.degree} link${node.degree === 1 ? '' : 's'}${err} · double-click to open in IDE`;
  }, []);

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
    <div ref={wrapRef} className="graph-wrap graph-wrap--force" onKeyDown={handleKeyDown} tabIndex={0}>
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
                    <span className="graph-search__hit-name">{node.kind === 'folder' ? `${node.folderPath}/` : node.id}</span>
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
          {view.folderCount} folders · {view.fileNodeCount} files
          {perf.sparseLabels ? ' · sparse labels' : denseGraph ? ' · labels adapt when zoomed' : ''}
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
              <button type="button" className="graph-toolbar__btn" onClick={() => openNode(selectedNode)}>
                Open in IDE
              </button>
            )}
            <button type="button" className="graph-toolbar__btn" onClick={() => centerOn(selectedNode)}>
              Centre
            </button>
            <button type="button" className="graph-toolbar__btn" onClick={() => onSelect(null)}>
              Clear
            </button>
          </div>
        </div>
      )}

      <div className="graph-canvas-wrap">
        <ForceGraph2D
          ref={graphRef}
          width={width}
          height={GRAPH_HEIGHT}
          graphData={graphData}
          backgroundColor={theme.page}
          nodeId="id"
          nodeLabel={nodeTooltip}
          nodeVisibility={nodeVisible}
          linkColor={linkColor}
          linkWidth={linkWidth}
          linkDirectionalArrowLength={3.5}
          linkDirectionalArrowRelPos={1}
          linkCurvature={0.12}
          autoPauseRedraw
          cooldownTicks={perf.cooldownTicks}
          cooldownTime={perf.cooldownTime}
          warmupTicks={perf.warmupTicks}
          d3AlphaDecay={perf.d3AlphaDecay}
          d3VelocityDecay={perf.d3VelocityDecay}
          d3AlphaMin={0.05}
          enableNodeDrag={perf.enableNodeDrag}
          enableZoomInteraction
          enablePanInteraction
          enablePointerInteraction
          showPointerCursor={(obj) => !!obj}
          onEngineStop={() => {
            if (!didInitialFit.current && !userAdjustedView.current) {
              graphRef.current?.zoomToFit(400, 48);
              didInitialFit.current = true;
            }
            graphRef.current?.pauseAnimation();
          }}
          onZoom={() => {
            userAdjustedView.current = true;
          }}
          onZoomEnd={() => {
            graphRef.current?.pauseAnimation();
            requestGraphRedraw();
          }}
          linkHoverPrecision={0}
          onNodeClick={activateNode}
          onNodeRightClick={(node, event) => {
            event.preventDefault();
            openNode(node);
          }}
          onNodeHover={(node) => {
            const id = node?.id ?? null;
            if (hoverIdRef.current === id) return;
            hoverIdRef.current = id;
            requestGraphRedraw();
          }}
          onBackgroundClick={() => onSelect(null)}
          nodeCanvasObjectMode={() => 'replace'}
          nodeCanvasObject={(node, ctx, globalScale) => paintNode(node, ctx, globalScale)}
          nodePointerAreaPaint={paintPointerArea}
          linkPointerAreaPaint={() => {
            /* links are visual only — avoid stealing clicks from node labels */
          }}
        />

        <div className="graph-zoom-controls" aria-label="Graph zoom controls">
          <button type="button" className="graph-zoom-controls__btn" onClick={() => zoomBy(1.35)} title="Zoom in">
            +
          </button>
          <button type="button" className="graph-zoom-controls__btn" onClick={() => zoomBy(1 / 1.35)} title="Zoom out">
            −
          </button>
          <button type="button" className="graph-zoom-controls__btn graph-zoom-controls__btn--fit" onClick={fitGraph} title="Fit graph to view">
            Fit
          </button>
        </div>
      </div>

      <p className="graph-wrap__hint">
        Click a <strong>folder</strong> to drill in · <strong>double-click</strong> a file to open in your IDE ·{' '}
        <kbd>/</kbd> to search · scroll to zoom · drag to pan
      </p>
    </div>
  );
};

export default DependencyGraph;
