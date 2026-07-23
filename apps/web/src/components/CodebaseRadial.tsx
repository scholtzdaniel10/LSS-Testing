/**
 * CodebaseRadial.tsx
 *
 * Hierarchical edge-bundling radial view (mbostock-style).
 * Pure SVG -- no d3 dependency. Layout computed in radialModel.ts.
 *
 * Layout:
 *  - One circle per connected component (largest -> biggest radius).
 *  - Files are positioned on the circumference via a radial cluster derived
 *    from the folder hierarchy.
 *  - Edges drawn as cubic Bezier splines that pass through the component
 *    centre (simulating bundle b ~0.85).
 *  - Unlinked files: summary badge + collapsible filtered list (never in SVG).
 *  - Click-to-focus: clicking a dot narrows to that file + its direct
 *    neighbours. Clicking a neighbour re-focuses on it.
 *  - Hover: highlights edges + neighbours without hiding others.
 *  - Zoom/pan: wheel zoom (cursor-anchored), drag pan, double-click or Fit to reset.
 *  - Label declutter: components > LABEL_THRESHOLD show dots only; labels
 *    appear for focused/hovered node and its direct neighbours.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RadialComponent, RadialEdge, RadialNode } from '../lib/radialModel';
import {
  buildRadialLayout,
  buildFolderLayout,
  buildDrillComponent,
  classifyEdges,
  computeFocusNeighbourhood,
  componentRadius,
  folderKeyOf,
  layoutLeavesHierarchical,
  shouldShowLabel,
} from '../lib/radialModel';
import type { GraphEdge, DiagnosticFinding, TreeFile } from '../api/client';

// -- SERIES palette (matches ExplorePage.tsx tree view) -----------------------
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

function folderColor(path: string): string {
  return SERIES[folderKeyOf(path)] ?? SERIES.other;
}

// -- Token refs ----------------------------------------------------------------
const COLOR_EDGE_HEALTHY = 'var(--ink-4)';
const COLOR_EDGE_BROKEN = 'var(--status-critical)';
const COLOR_NODE_DEFAULT = 'var(--ink-2)';
const COLOR_NODE_ERROR = 'var(--status-critical)';
const COLOR_NODE_FOCUS = 'var(--neon-cyan)';
const COLOR_NODE_NEIGHBOUR = 'var(--neon-yellow)';
const COLOR_NODE_FADED = 'var(--ink-4)';
const COLOR_EDGE_HOVER = 'var(--neon-cyan)';

// -- Geometry helpers ----------------------------------------------------------

/** Polar -> Cartesian (angle in radians, 0 = top). */
function polar(angle: number, r: number, cx: number, cy: number): [number, number] {
  return [cx + r * Math.sin(angle), cy - r * Math.cos(angle)];
}

/**
 * Build a cubic Bezier path string that bundles through the component centre.
 * beta controls tightness (0 = straight, 1 = fully through centre).
 */
function bundlePath(
  x0: number, y0: number,
  x1: number, y1: number,
  cx: number, cy: number,
  beta = 0.85,
): string {
  const cp0x = x0 + beta * (cx - x0);
  const cp0y = y0 + beta * (cy - y0);
  const cp1x = x1 + beta * (cx - x1);
  const cp1y = y1 + beta * (cy - y1);
  return `M${x0},${y0} C${cp0x},${cp0y} ${cp1x},${cp1y} ${x1},${y1}`;
}

// -- Leaf position computation -------------------------------------------------

type LeafPosition = {
  node: RadialNode;
  angle: number;
  x: number;
  y: number;
  labelX: number;
  labelY: number;
  textAnchor: 'start' | 'end';
  rotate: number;
};

/**
 * Assign angles to leaves by walking the hierarchy in DFS order.
 * Sibling subtrees occupy contiguous arcs (folder-grouped sectors).
 */
function layoutLeaves(
  root: RadialNode,
  radius: number,
  cx: number,
  cy: number,
): LeafPosition[] {
  return layoutLeavesHierarchical(root, radius, cx, cy, polar);
}

// -- Component circle ----------------------------------------------------------

type ComponentCircleProps = {
  component: RadialComponent;
  cx: number;
  cy: number;
  radius: number;
  focusFile: string | null;
  hoveredFile: string | null;
  onFileClick: (path: string) => void;
  onFileHover: (path: string | null) => void;
  onFocusUrl: (path: string) => void;
  errorFiles: ReadonlySet<string>;
  /** When true, colour nodes by top-level folder (SERIES palette). */
  useFolderColors: boolean;
  /** Centre label for folder-grouped circles (e.g. application, system). */
  groupLabel?: string;
};

function ComponentCircle({
  component,
  cx,
  cy,
  radius,
  focusFile,
  hoveredFile,
  onFileClick,
  onFileHover,
  onFocusUrl,
  errorFiles,
  useFolderColors,
  groupLabel,
}: ComponentCircleProps) {
  const positions = useMemo(
    () => layoutLeaves(component.root, radius, cx, cy),
    [component.root, radius, cx, cy],
  );

  const posMap = useMemo(() => {
    const m = new Map<string, LeafPosition>();
    for (const p of positions) m.set(p.node.id, p);
    return m;
  }, [positions]);

  const focusNb = useMemo(
    () =>
      focusFile
        ? computeFocusNeighbourhood(focusFile, component.edges)
        : null,
    [focusFile, component.edges],
  );

  const hoverNb = useMemo(
    () =>
      hoveredFile
        ? computeFocusNeighbourhood(hoveredFile, component.edges)
        : null,
    [hoveredFile, component.edges],
  );

  const activeNeighbours = useMemo<ReadonlySet<string>>(() => {
    const s = new Set<string>();
    if (focusNb) for (const n of focusNb.neighbours) s.add(n);
    if (hoverNb) for (const n of hoverNb.neighbours) s.add(n);
    return s;
  }, [focusNb, hoverNb]);

  const memberCount = component.files.length;
  const activeFocus = focusFile ?? hoveredFile ?? null;

  const isVisible = (path: string) => {
    if (!focusNb) return true;
    return path === focusNb.focus || focusNb.neighbours.has(path);
  };

  const isEdgeVisible = (e: RadialEdge) => {
    if (!focusNb) return true;
    return (
      (e.from === focusNb.focus || focusNb.neighbours.has(e.from)) &&
      (e.to === focusNb.focus || focusNb.neighbours.has(e.to))
    );
  };

  const edgeStroke = (e: RadialEdge): string => {
    if (hoverNb && (e.from === hoverNb.focus || hoverNb.neighbours.has(e.from)) &&
        (e.to === hoverNb.focus || hoverNb.neighbours.has(e.to))) {
      return COLOR_EDGE_HOVER;
    }
    return e.broken ? COLOR_EDGE_BROKEN : COLOR_EDGE_HEALTHY;
  };

  const nodeColor = (path: string): string => {
    if (path === focusFile) return COLOR_NODE_FOCUS;
    if (focusNb?.neighbours.has(path)) return COLOR_NODE_NEIGHBOUR;
    if (hoveredFile && hoverNb && (path === hoveredFile || hoverNb.neighbours.has(path))) {
      return COLOR_NODE_NEIGHBOUR;
    }
    if (!isVisible(path)) return COLOR_NODE_FADED;
    if (errorFiles.has(path)) return COLOR_NODE_ERROR;
    if (useFolderColors) return folderColor(path);
    return COLOR_NODE_DEFAULT;
  };

  const edgeOpacity = (e: RadialEdge): number => {
    if (!focusNb) {
      if (hoverNb) {
        return (e.from === hoverNb.focus || hoverNb.neighbours.has(e.from)) &&
               (e.to === hoverNb.focus || hoverNb.neighbours.has(e.to))
          ? 0.85
          : 0.12;
      }
      return e.broken ? 0.55 : 0.15;
    }
    return isEdgeVisible(e) ? 0.85 : 0.04;
  };

  const nodeOpacity = (path: string): number => {
    if (!focusNb && !hoverNb) return 1;
    if (focusNb && !isVisible(path)) return 0.25;
    if (hoverNb && !focusNb && path !== hoveredFile && !hoverNb.neighbours.has(path)) return 0.35;
    return 1;
  };

  return (
    <g>
      <circle
        cx={cx}
        cy={cy}
        r={radius}
        fill="none"
        stroke="var(--line-1)"
        strokeWidth={0.5}
        strokeDasharray="3 6"
        pointerEvents="none"
      />

      {groupLabel && (
        <text
          x={cx}
          y={cy}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="var(--text-sm)"
          fontFamily="var(--font-mono)"
          fontWeight={600}
          fill={SERIES[groupLabel] ?? SERIES.other}
          style={{ userSelect: 'none', pointerEvents: 'none' }}
        >
          {groupLabel}/
        </text>
      )}

      {component.edges.map((e, i) => {
        const src = posMap.get(e.from);
        const tgt = posMap.get(e.to);
        if (!src || !tgt) return null;
        return (
          <path
            key={i}
            d={bundlePath(src.x, src.y, tgt.x, tgt.y, cx, cy)}
            fill="none"
            stroke={edgeStroke(e)}
            strokeWidth={focusNb && isEdgeVisible(e) ? 1.5 : 1}
            opacity={edgeOpacity(e)}
            pointerEvents="none"
            style={{ transition: 'opacity 0.15s, stroke 0.15s' }}
          />
        );
      })}

      {positions.map((pos) => {
        const path = pos.node.id;
        const hasError = errorFiles.has(path);
        const color = nodeColor(path);
        const op = nodeOpacity(path);
        const isFocused = path === focusFile;
        const basename = pos.node.name;
        const showLabel = shouldShowLabel(memberCount, path, activeFocus, activeNeighbours);

        return (
          <g
            key={path}
            opacity={op}
            style={{ cursor: 'pointer', transition: 'opacity 0.15s' }}
            onClick={() => onFileClick(path)}
            onMouseEnter={() => onFileHover(path)}
            onMouseLeave={() => onFileHover(null)}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter' || ev.key === ' ') {
                ev.preventDefault();
                onFileClick(path);
              }
            }}
            tabIndex={0}
            role="button"
            aria-label={`File: ${path}${hasError ? ' (has errors)' : ''}`}
            aria-pressed={isFocused}
          >
            <circle
              cx={pos.x}
              cy={pos.y}
              r={isFocused ? 5 : hasError ? 4 : 3}
              fill={color}
              stroke={
                isFocused
                  ? 'var(--surface-page)'
                  : hasError && useFolderColors
                  ? COLOR_NODE_ERROR
                  : 'none'
              }
              strokeWidth={isFocused ? 1.5 : hasError && useFolderColors ? 1.5 : 0}
              pointerEvents="none"
            />
            {/* Invisible hit target -- larger than the visual dot */}
            <circle
              cx={pos.x}
              cy={pos.y}
              r={10}
              fill="transparent"
              pointerEvents="all"
            />
            {showLabel && (
              <text
                x={pos.labelX}
                y={pos.labelY}
                fontSize="var(--text-xs)"
                fontFamily="var(--font-mono)"
                fill={color}
                textAnchor={pos.textAnchor}
                dominantBaseline="central"
                transform={`rotate(${pos.rotate}, ${pos.labelX}, ${pos.labelY})`}
                style={{ userSelect: 'none', pointerEvents: 'none' }}
              >
                {basename}
              </text>
            )}
          </g>
        );
      })}

      {focusFile && positions.map((pos) => {
        if (pos.node.id !== focusFile) return null;
        return (
          <g key="focus-info">
            <foreignObject
              x={cx - 120}
              y={cy - 28}
              width={240}
              height={56}
              style={{ pointerEvents: 'none' }}
            >
              {/* @ts-expect-error -- xmlns needed for SVG foreignObject */}
              <div xmlns="http://www.w3.org/1999/xhtml"
                style={{
                  background: 'var(--surface-raised)',
                  border: '1px solid var(--line-2)',
                  borderRadius: 'var(--radius-md)',
                  padding: '4px 8px',
                  fontSize: 'var(--text-xs)',
                  color: 'var(--ink-2)',
                  pointerEvents: 'auto',
                  textAlign: 'center',
                  lineHeight: 1.4,
                }}
              >
                <span style={{ color: 'var(--neon-cyan)', fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>
                  {focusFile}
                </span>
                <br />
                <button
                  type="button"
                  style={{
                    marginTop: 2,
                    fontSize: 'var(--text-xs)',
                    color: 'var(--ink-3)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 0,
                    textDecoration: 'underline',
                  }}
                  onClick={(ev) => { ev.stopPropagation(); onFocusUrl(focusFile); }}
                >
                  focus in tree &rarr;
                </button>
              </div>
            </foreignObject>
          </g>
        );
      })}
    </g>
  );
}

// -- Layout packing -----------------------------------------------------------

type CirclePlacement = {
  cx: number;
  cy: number;
  radius: number;
};

function packComponents(
  components: RadialComponent[],
  maxWidth: number,
): { placements: CirclePlacement[]; totalHeight: number } {
  const PAD = 32;
  const radii = components.map((c) => componentRadius(c.files.length));
  const placements: CirclePlacement[] = [];
  let x = 0;
  let rowTop = 0;
  let rowMaxDiameter = 0;
  let totalHeight = 0;

  for (let i = 0; i < components.length; i++) {
    const r = radii[i];
    const lm = Math.max(48, Math.min(90, Math.round(r * 0.35)));
    const diameter = (r + lm) * 2 + PAD;

    if (x + diameter > maxWidth && i > 0) {
      rowTop += rowMaxDiameter;
      x = 0;
      rowMaxDiameter = 0;
    }

    placements.push({
      cx: x + r + lm + PAD / 2,
      cy: rowTop + r + lm + PAD / 2,
      radius: r,
    });

    x += diameter;
    rowMaxDiameter = Math.max(rowMaxDiameter, diameter);
    totalHeight = rowTop + diameter;
  }

  return { placements, totalHeight };
}

// -- Main component -----------------------------------------------------------

export type CodebaseRadialProps = {
  edges: GraphEdge[];
  findings: DiagnosticFinding[];
  files: TreeFile[];
  /** Current ?focus= query param value (for two-way sync). */
  focusParam: string | null;
  /** Called when the user selects a file and wants to focus the tree. */
  onFocusTree: (path: string) => void;
};

// -- localStorage helpers -----------------------------------------------------

type GroupingMode = 'component' | 'folder';

function readLS<T>(key: string, fallback: T, parse: (v: string) => T | undefined): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return parse(raw) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeLS(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}

const LS_GROUPING = 'lss.radial.grouping';
const LS_DRILL    = 'lss.radial.drill';

// -- Main exported component --------------------------------------------------

const CodebaseRadial: React.FC<CodebaseRadialProps> = ({
  edges,
  findings,
  files,
  focusParam,
  onFocusTree,
}) => {
  const [focusFile, setFocusFile] = useState<string | null>(focusParam ?? null);
  const [hoveredFile, setHoveredFile] = useState<string | null>(null);

  // IG-27: grouping mode (component | folder) -- persisted to localStorage
  const [groupingMode, setGroupingMode] = useState<GroupingMode>(() =>
    readLS(LS_GROUPING, 'folder' as GroupingMode, (v) =>
      v === 'component' || v === 'folder' ? v : undefined,
    ),
  );

  // IG-27: drill mode -- persisted to localStorage
  const [drillMode, setDrillMode] = useState<boolean>(() =>
    readLS(LS_DRILL, false, (v) => (v === 'true' ? true : v === 'false' ? false : undefined)),
  );

  // IG-27: drill breadcrumb chain -- list of file paths drilled into (empty = full map)
  const [drillChain, setDrillChain] = useState<string[]>([]);

  const setGrouping = useCallback((mode: GroupingMode) => {
    setGroupingMode(mode);
    writeLS(LS_GROUPING, mode);
  }, []);

  const setDrill = useCallback((on: boolean) => {
    setDrillMode(on);
    writeLS(LS_DRILL, String(on));
    if (!on) setDrillChain([]);
  }, []);

  // Zoom/pan state: transform a root <g> inside the fixed SVG.
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const dragging = useRef(false);
  /** true only when the pointer has moved beyond the click-vs-pan threshold */
  const didPan = useRef(false);
  const dragStart = useRef<{ mx: number; my: number; px: number; py: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const resetView = useCallback(() => {
    setZoom(1);
    setPanX(0);
    setPanY(0);
  }, []);

  // Native (non-passive) wheel listener so preventDefault() actually works.
  // React registers synthetic onWheel as passive, which ignores preventDefault.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      ev.stopPropagation();
      const factor = ev.deltaY < 0 ? 1.12 : 1 / 1.12;
      const rect = svg.getBoundingClientRect();
      const mx = ev.clientX - rect.left;
      const my = ev.clientY - rect.top;
      setZoom((z) => {
        const nz = Math.min(8, Math.max(0.15, z * factor));
        const scaleDiff = nz - z;
        setPanX((px) => px - (mx * scaleDiff) / nz);
        setPanY((py) => py - (my * scaleDiff) / nz);
        return nz;
      });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  const handleMouseDown = useCallback((ev: React.MouseEvent<SVGSVGElement>) => {
    if ((ev.target as Element).closest('[role="button"]')) return;
    dragging.current = true;
    didPan.current = false;
    dragStart.current = { mx: ev.clientX, my: ev.clientY, px: panX, py: panY };
    ev.preventDefault();
  }, [panX, panY]);

  const handleMouseMove = useCallback((ev: React.MouseEvent<SVGSVGElement>) => {
    if (!dragging.current || !dragStart.current) return;
    const dx = (ev.clientX - dragStart.current.mx) / zoom;
    const dy = (ev.clientY - dragStart.current.my) / zoom;
    // Only start panning after moving beyond a 3px threshold.
    const rawDx = ev.clientX - dragStart.current.mx;
    const rawDy = ev.clientY - dragStart.current.my;
    if (!didPan.current && Math.sqrt(rawDx * rawDx + rawDy * rawDy) < 3) return;
    didPan.current = true;
    setPanX(dragStart.current.px + dx);
    setPanY(dragStart.current.py + dy);
  }, [zoom]);

  const handleMouseUp = useCallback(() => {
    dragging.current = false;
    didPan.current = false;
    dragStart.current = null;
  }, []);

  const handleDblClick = useCallback((ev: React.MouseEvent<SVGSVGElement>) => {
    if ((ev.target as Element).closest('[role="button"]')) return;
    resetView();
  }, [resetView]);

  useEffect(() => {
    setFocusFile(focusParam ?? null);
  }, [focusParam]);

  const errorFiles = useMemo(() => {
    const s = new Set<string>();
    for (const f of findings) {
      if (f.severity === 'error') s.add(f.file);
    }
    return s;
  }, [findings]);

  const allFilePaths = useMemo(() => files.map((f) => f.path), [files]);

  // Full classified edge set -- used for drill neighbourhood computation.
  const allClassifiedEdges = useMemo(() => {
    const isExternal = (p: string) => p.startsWith('pkg:') || p.startsWith('php:');
    const allFileSet = new Set(allFilePaths);
    const internal = edges
      .filter((e) => !isExternal(e.from) && !isExternal(e.to))
      .filter((e) => allFileSet.has(e.from) && allFileSet.has(e.to));
    return classifyEdges(internal, errorFiles);
  }, [edges, allFilePaths, errorFiles]);

  const baseLayout = useMemo(
    () =>
      groupingMode === 'folder'
        ? buildFolderLayout(allFilePaths, edges, errorFiles)
        : buildRadialLayout(allFilePaths, edges, errorFiles),
    [allFilePaths, edges, errorFiles, groupingMode],
  );

  // When drill mode is active and a drill chain exists, render only the drill circle.
  const drillFile = drillMode && drillChain.length > 0 ? drillChain[drillChain.length - 1] : null;
  const drillComponent = useMemo(
    () => (drillFile ? buildDrillComponent(drillFile, allClassifiedEdges) : null),
    [drillFile, allClassifiedEdges],
  );

  const layout = drillComponent
    ? { components: [drillComponent], unlinked: { files: [] } }
    : baseLayout;

  const SVG_WIDTH = 1400;
  const { placements, totalHeight } = useMemo(
    () => packComponents(layout.components, SVG_WIDTH),
    [layout.components],
  );
  const svgHeight = Math.max(totalHeight, 80);

  const handleFileClick = useCallback((path: string) => {
    if (drillMode) {
      // In drill mode, clicking drills into that node's neighbourhood.
      setDrillChain((prev) => [...prev, path]);
      setFocusFile(null);
    } else {
      setFocusFile((prev) => (prev === path ? null : path));
    }
  }, [drillMode]);

  const handleHover = useCallback((path: string | null) => {
    setHoveredFile(path);
  }, []);

  const handleFocusUrl = useCallback(
    (path: string) => {
      onFocusTree(path);
    },
    [onFocusTree],
  );

  const clearFocus = useCallback(() => {
    setFocusFile(null);
    setHoveredFile(null);
    setDrillChain([]);
  }, []);

  const brokenCount = useMemo(() => {
    let n = 0;
    for (const c of layout.components) {
      n += c.edges.filter((e) => e.broken).length;
    }
    return n;
  }, [layout]);

  const totalEdges = useMemo(() => {
    return layout.components.reduce((acc, c) => acc + c.edges.length, 0);
  }, [layout]);

  const [unlinkedOpen, setUnlinkedOpen] = useState(false);
  const [unlinkedFilter, setUnlinkedFilter] = useState('');

  const filteredUnlinked = useMemo(() => {
    if (!unlinkedFilter.trim()) return layout.unlinked.files;
    const q = unlinkedFilter.trim().toLowerCase();
    return layout.unlinked.files.filter((f) => f.toLowerCase().includes(q));
  }, [layout.unlinked.files, unlinkedFilter]);

  const svgDisplayHeight = typeof window !== 'undefined'
    ? Math.min(svgHeight, window.innerHeight * 0.65)
    : svgHeight;

  const layoutFitKey = `${groupingMode}|${drillChain.join('>')}|${layout.components.map((c) => `${c.index}:${c.files.length}`).join(',')}`;
  const lastFitKey = useRef('');

  // Fit packed circles into the viewport when grouping or drill context changes.
  useEffect(() => {
    if (layout.components.length === 0 || placements.length === 0) {
      resetView();
      return;
    }
    if (lastFitKey.current === layoutFitKey) return;
    lastFitKey.current = layoutFitKey;

    const pad = 40;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = 0;
    let maxY = 0;
    for (const pl of placements) {
      const margin = pl.radius + 72;
      minX = Math.min(minX, pl.cx - margin);
      minY = Math.min(minY, pl.cy - margin);
      maxX = Math.max(maxX, pl.cx + margin);
      maxY = Math.max(maxY, pl.cy + margin);
    }
    const contentW = maxX - minX;
    const contentH = maxY - minY;
    const viewW = svgRef.current?.clientWidth ?? SVG_WIDTH;
    const fitZoom = Math.min(1, (viewW - pad * 2) / contentW, (svgDisplayHeight - pad * 2) / contentH);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const z = Math.max(0.2, fitZoom);
    setZoom(z);
    setPanX(viewW / (2 * z) - cx);
    setPanY(svgDisplayHeight / (2 * z) - cy);
  }, [layoutFitKey, layout.components.length, placements, svgDisplayHeight, resetView]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--sp-3)',
          flexWrap: 'wrap',
        }}
      >
        <span className="panel__hint">
          {layout.components.length} component{layout.components.length !== 1 ? 's' : ''} &middot;{'  '}
          {totalEdges} edge{totalEdges !== 1 ? 's' : ''}
          {brokenCount > 0 && (
            <span style={{ color: 'var(--status-critical)', marginLeft: 6 }}>
              &middot; {brokenCount} broken
            </span>
          )}
          {layout.unlinked.files.length > 0 && (
            <button
              type="button"
              style={{
                marginLeft: 8,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--ink-3)',
                fontSize: 'inherit',
                textDecoration: 'underline dotted',
                padding: 0,
              }}
              onClick={() => setUnlinkedOpen((o) => !o)}
              aria-expanded={unlinkedOpen}
            >
              {layout.unlinked.files.length.toLocaleString()} unlinked files
            </button>
          )}
        </span>

        {/* Grouping toggle (IG-27) */}
        <div
          role="group"
          aria-label="Grouping mode"
          style={{ display: 'flex', gap: '2px', background: 'var(--surface-raised)', borderRadius: 'var(--radius-sm)', padding: '2px' }}
        >
          <button
            type="button"
            aria-pressed={groupingMode === 'component'}
            onClick={() => setGrouping('component')}
            style={{
              fontSize: 'var(--text-xs)',
              padding: '2px 8px',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              cursor: 'pointer',
              background: groupingMode === 'component' ? 'var(--surface-wash)' : 'none',
              color: groupingMode === 'component' ? 'var(--ink-1)' : 'var(--ink-3)',
            }}
          >
            By component
          </button>
          <button
            type="button"
            aria-pressed={groupingMode === 'folder'}
            onClick={() => setGrouping('folder')}
            style={{
              fontSize: 'var(--text-xs)',
              padding: '2px 8px',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              cursor: 'pointer',
              background: groupingMode === 'folder' ? 'var(--surface-wash)' : 'none',
              color: groupingMode === 'folder' ? 'var(--ink-1)' : 'var(--ink-3)',
            }}
          >
            By folder
          </button>
        </div>

        {/* Drill mode toggle (IG-27) */}
        <button
          type="button"
          aria-pressed={drillMode}
          onClick={() => setDrill(!drillMode)}
          style={{
            fontSize: 'var(--text-xs)',
            padding: '2px 8px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--line-2)',
            cursor: 'pointer',
            background: drillMode ? 'var(--surface-wash)' : 'none',
            color: drillMode ? 'var(--ink-1)' : 'var(--ink-3)',
          }}
          title="When on, clicking a node re-draws the view centred on that node neighbourhood"
        >
          Drill {drillMode ? 'on' : 'off'}
        </button>

        <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
          {(focusFile || drillChain.length > 0) && (
            <button
              type="button"
              className="btn"
              onClick={clearFocus}
              style={{ fontSize: 'var(--text-sm)', padding: '2px 10px' }}
            >
              Show all
            </button>
          )}
          <button
            type="button"
            className="btn"
            onClick={resetView}
            style={{ fontSize: 'var(--text-sm)', padding: '2px 10px' }}
            title="Reset zoom/pan (also double-click canvas)"
          >
            Fit
          </button>
        </div>

        <div style={{ display: 'flex', gap: 'var(--sp-3)', marginLeft: 'auto', alignItems: 'center' }}>
          <LegendItem color="var(--ink-4)" label="healthy edge" isDash />
          <LegendItem color="var(--status-critical)" label="broken edge" isDash />
          <LegendItem color="var(--status-critical)" label="error file" />
        </div>
      </div>

      {/* Drill breadcrumb trail (IG-27) */}
      {drillMode && drillChain.length > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            flexWrap: 'wrap',
            fontSize: 'var(--text-xs)',
            fontFamily: 'var(--font-mono)',
            color: 'var(--ink-3)',
          }}
          aria-label="Drill breadcrumb trail"
        >
          <button
            type="button"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', padding: 0, textDecoration: 'underline dotted', fontSize: 'inherit', fontFamily: 'inherit' }}
            onClick={() => setDrillChain([])}
          >
            All
          </button>
          {drillChain.map((crumb, i) => {
            const isLast = i === drillChain.length - 1;
            return (
              <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ color: 'var(--ink-4)' }}>&rsaquo;</span>
                <button
                  type="button"
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: isLast ? 'default' : 'pointer',
                    color: isLast ? 'var(--neon-cyan)' : 'var(--ink-3)',
                    padding: 0,
                    textDecoration: isLast ? 'none' : 'underline dotted',
                    fontSize: 'inherit',
                    fontFamily: 'inherit',
                  }}
                  onClick={() => { if (!isLast) setDrillChain(drillChain.slice(0, i + 1)); }}
                  aria-current={isLast ? 'step' : undefined}
                >
                  {crumb.split('/').pop() ?? crumb}
                </button>
              </span>
            );
          })}
        </div>
      )}

      {/* Unlinked files -- collapsible, never rendered in SVG */}
      {layout.unlinked.files.length > 0 && unlinkedOpen && (
        <div className="panel" style={{ padding: 'var(--sp-3)' }}>
          <div className="panel__head" style={{ marginBottom: 'var(--sp-2)' }}>
            <h3 className="panel__title" style={{ fontSize: 'var(--text-sm)' }}>
              {layout.unlinked.files.length.toLocaleString()} unlinked files
            </h3>
            <span className="panel__hint">no dependency edges -- not rendered in the map</span>
          </div>
          <input
            type="search"
            placeholder="Filter by path..."
            value={unlinkedFilter}
            onChange={(ev) => setUnlinkedFilter(ev.target.value)}
            aria-label="Filter unlinked files"
            style={{
              width: '100%',
              boxSizing: 'border-box',
              marginBottom: 'var(--sp-2)',
              padding: '4px 8px',
              fontSize: 'var(--text-sm)',
              fontFamily: 'var(--font-mono)',
              background: 'var(--surface-wash)',
              border: '1px solid var(--line-2)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--ink-1)',
            }}
          />
          <ul
            aria-label="Unlinked files list"
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              maxHeight: 240,
              overflowY: 'auto',
            }}
          >
            {filteredUnlinked.length === 0 && (
              <li style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-4)', padding: '4px 0' }}>
                No matches.
              </li>
            )}
            {filteredUnlinked.map((f) => (
              <li key={f}>
                <button
                  type="button"
                  aria-label={`Unlinked file: ${f}`}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '3px 4px',
                    fontSize: 'var(--text-xs)',
                    fontFamily: 'var(--font-mono)',
                    color: errorFiles.has(f)
                      ? 'var(--status-critical)'
                      : focusFile === f
                      ? 'var(--neon-cyan)'
                      : 'var(--ink-3)',
                    borderRadius: 'var(--radius-sm)',
                    outline: focusFile === f ? '1px solid var(--neon-cyan)' : 'none',
                  }}
                  onClick={() => {
                    setFocusFile((prev) => (prev === f ? null : f));
                    onFocusTree(f);
                  }}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter' || ev.key === ' ') {
                      ev.preventDefault();
                      setFocusFile((prev) => (prev === f ? null : f));
                      onFocusTree(f);
                    }
                  }}
                >
                  {f}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* SVG radial canvas with zoom/pan */}
      <div
        style={{
          overflow: 'hidden',
          maxHeight: '65vh',
          background: 'var(--surface-panel)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--line-1)',
          cursor: 'grab',
          overscrollBehavior: 'contain',
          touchAction: 'none',
        }}
        role="img"
        aria-label="Codebase radial map"
      >
        {layout.components.length === 0 ? (
          <div style={{ padding: 'var(--sp-5)', color: 'var(--ink-3)', fontSize: 'var(--text-sm)' }}>
            No linked files to display.
          </div>
        ) : (
          <svg
            ref={svgRef}
            width="100%"
            height={svgDisplayHeight}
            viewBox={`0 0 ${SVG_WIDTH} ${svgDisplayHeight}`}
            style={{ display: 'block', touchAction: 'none' }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onDoubleClick={handleDblClick}
            onClick={(ev) => {
              if (ev.target === ev.currentTarget) clearFocus();
            }}
          >
            <g transform={`scale(${zoom}) translate(${panX},${panY})`}>
              {layout.components.map((component, i) => {
                const pl = placements[i];
                if (!pl) return null;
                return (
                  <ComponentCircle
                    key={component.index}
                    component={component}
                    cx={pl.cx}
                    cy={pl.cy}
                    radius={pl.radius}
                    focusFile={focusFile}
                    hoveredFile={hoveredFile}
                    onFileClick={handleFileClick}
                    onFileHover={handleHover}
                    onFocusUrl={handleFocusUrl}
                    errorFiles={errorFiles}
                    useFolderColors={groupingMode === 'folder' || drillMode}
                    groupLabel={groupingMode === 'folder' ? component.groupKey : undefined}
                  />
                );
              })}
            </g>
          </svg>
        )}
      </div>

      {/* Selected file detail strip */}
      {focusFile && (
        <div
          className="panel"
          style={{
            padding: 'var(--sp-3)',
            borderLeft: '3px solid var(--neon-cyan)',
            fontSize: 'var(--text-sm)',
          }}
          role="status"
          aria-label="Selected file detail"
        >
          <span style={{ color: 'var(--neon-cyan)', fontFamily: 'var(--font-mono)' }}>
            {focusFile}
          </span>
          {errorFiles.has(focusFile) && (
            <span style={{ marginLeft: 8, color: 'var(--status-critical)' }}>
              has error-severity findings
            </span>
          )}
          {layout.unlinked.files.includes(focusFile) && (
            <span style={{ marginLeft: 8, color: 'var(--ink-4)', fontSize: 'var(--text-xs)' }}>
              (unlinked)
            </span>
          )}
          <button
            type="button"
            style={{
              marginLeft: 12,
              fontSize: 'var(--text-xs)',
              color: 'var(--ink-3)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              textDecoration: 'underline',
            }}
            onClick={() => onFocusTree(focusFile)}
          >
            focus in tree &rarr;
          </button>
        </div>
      )}
    </div>
  );
};

// -- Legend item --------------------------------------------------------------

function LegendItem({
  color,
  label,
  isDash = false,
}: {
  color: string;
  label: string;
  isDash?: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      {isDash ? (
        <svg width={18} height={6}>
          <line x1={0} y1={3} x2={18} y2={3} stroke={color} strokeWidth={1.5} strokeDasharray="3 2" />
        </svg>
      ) : (
        <svg width={8} height={8}>
          <circle cx={4} cy={4} r={3} fill={color} />
        </svg>
      )}
      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)' }}>{label}</span>
    </div>
  );
}

export default CodebaseRadial;
