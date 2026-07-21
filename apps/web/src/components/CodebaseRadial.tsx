/**
 * CodebaseRadial.tsx
 *
 * Hierarchical edge-bundling radial view (mbostock-style).
 * Pure SVG — no d3 dependency. Layout computed in radialModel.ts.
 *
 * Layout:
 *  - One circle per connected component (largest → biggest radius).
 *  - Files are positioned on the circumference via a radial cluster derived
 *    from the folder hierarchy.
 *  - Edges drawn as cubic Bézier splines that pass through the component
 *    centre (simulating bundle β ≈ 0.85).
 *  - Unlinked files in a compact list panel below the circles.
 *  - Click-to-focus: clicking a label narrows to that file + its direct
 *    neighbours. Clicking a neighbour re-focuses on it.
 *  - Hover: highlights edges + neighbours without hiding others.
 *  - "Show all" button clears focus.
 */

import { useCallback, useMemo, useState } from 'react';
import type { RadialComponent, RadialEdge, RadialNode } from '../lib/radialModel';
import {
  buildRadialLayout,
  collectLeaves,
  computeFocusNeighbourhood,
} from '../lib/radialModel';
import type { GraphEdge, DiagnosticFinding, TreeFile } from '../api/client';

// ── Token refs ────────────────────────────────────────────────────────────────
const COLOR_EDGE_HEALTHY = 'var(--ink-4)';
const COLOR_EDGE_BROKEN = 'var(--status-critical)';
const COLOR_NODE_DEFAULT = 'var(--ink-2)';
const COLOR_NODE_ERROR = 'var(--status-critical)';
const COLOR_NODE_FOCUS = 'var(--neon-cyan)';
const COLOR_NODE_NEIGHBOUR = 'var(--neon-yellow)';
const COLOR_NODE_FADED = 'var(--ink-4)';
const COLOR_EDGE_HOVER = 'var(--neon-cyan)';

// ── Geometry helpers ──────────────────────────────────────────────────────────

/** Polar → Cartesian (angle in radians, 0 = top). */
function polar(angle: number, r: number, cx: number, cy: number): [number, number] {
  return [cx + r * Math.sin(angle), cy - r * Math.cos(angle)];
}

/**
 * Build a cubic Bézier path string that bundles through the component centre.
 * β controls "tightness" (0 = straight, 1 = fully through centre).
 */
function bundlePath(
  x0: number, y0: number,
  x1: number, y1: number,
  cx: number, cy: number,
  beta = 0.85,
): string {
  // Control points: lerp from endpoints toward the centre.
  const cp0x = x0 + beta * (cx - x0);
  const cp0y = y0 + beta * (cy - y0);
  const cp1x = x1 + beta * (cx - x1);
  const cp1y = y1 + beta * (cy - y1);
  return `M${x0},${y0} C${cp0x},${cp0y} ${cp1x},${cp1y} ${x1},${y1}`;
}

// ── Leaf position computation ─────────────────────────────────────────────────

type LeafPosition = {
  node: RadialNode;
  angle: number; // radians
  x: number;
  y: number;
  labelX: number;
  labelY: number;
  textAnchor: 'start' | 'end';
  rotate: number; // degrees for the label transform
};

/**
 * Assign angles to leaves by walking the hierarchy in DFS order.
 * Leaves are evenly spaced on the circle.
 */
function layoutLeaves(
  root: RadialNode,
  radius: number,
  cx: number,
  cy: number,
): LeafPosition[] {
  const leaves = collectLeaves(root);
  const n = leaves.length;
  if (n === 0) return [];

  const labelR = radius + 12;

  return leaves.map((leaf, i) => {
    // Spread evenly; start from the top (−π/2 offset baked into polar()).
    const angle = (2 * Math.PI * i) / n;
    const [x, y] = polar(angle, radius, cx, cy);
    const [lx, ly] = polar(angle, labelR, cx, cy);
    // Text anchor: right half of circle → start; left half → end.
    const deg = ((angle * 180) / Math.PI + 360) % 360;
    const textAnchor = deg <= 180 ? 'start' : 'end';
    // Rotate label to read radially.
    const rotate = deg <= 180 ? deg - 90 : deg + 90;
    return { node: leaf, angle, x, y, labelX: lx, labelY: ly, textAnchor, rotate };
  });
}

// ── Component circle ──────────────────────────────────────────────────────────

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

  // Compute focus neighbourhood for dimming logic.
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
    return COLOR_NODE_DEFAULT;
  };

  const edgeOpacity = (e: RadialEdge): number => {
    if (!focusNb) {
      if (hoverNb) {
        return (e.from === hoverNb.focus || hoverNb.neighbours.has(e.from)) &&
               (e.to === hoverNb.focus || hoverNb.neighbours.has(e.to))
          ? 1
          : 0.15;
      }
      return 0.55;
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
      {/* Subtle guide circle */}
      <circle
        cx={cx}
        cy={cy}
        r={radius}
        fill="none"
        stroke="var(--line-1)"
        strokeWidth={0.5}
        strokeDasharray="3 6"
      />

      {/* Edges */}
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
            style={{ transition: 'opacity 0.15s, stroke 0.15s' }}
          />
        );
      })}

      {/* Node dots + labels */}
      {positions.map((pos) => {
        const path = pos.node.id;
        const hasError = errorFiles.has(path);
        const color = nodeColor(path);
        const op = nodeOpacity(path);
        const isFocused = path === focusFile;
        const basename = pos.node.name;

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
              stroke={isFocused ? 'var(--surface-page)' : 'none'}
              strokeWidth={isFocused ? 1.5 : 0}
            />
            <text
              x={pos.labelX}
              y={pos.labelY}
              fontSize="var(--text-xs)"
              fontFamily="var(--font-mono)"
              fill={color}
              textAnchor={pos.textAnchor}
              dominantBaseline="central"
              transform={`rotate(${pos.rotate}, ${pos.labelX}, ${pos.labelY})`}
              style={{ userSelect: 'none' }}
            >
              {basename}
            </text>
          </g>
        );
      })}

      {/* Selected file detail: full path + focus-URL link — rendered as a
          small panel overlaid near the node */}
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
              {/* eslint-disable-next-line @typescript-eslint/ban-ts-comment */}
              {/* @ts-ignore — xmlns needed for SVG foreignObject */}
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
                  focus in tree →
                </button>
              </div>
            </foreignObject>
          </g>
        );
      })}
    </g>
  );
}

// ── Layout packing ────────────────────────────────────────────────────────────

/**
 * Compute radius and (cx, cy) for each component.
 * Larger components get larger radii; everything is packed left-to-right
 * wrapping at a max row width.
 */
type CirclePlacement = {
  cx: number;
  cy: number;
  radius: number;
};

function packComponents(
  components: RadialComponent[],
  maxWidth: number,
): { placements: CirclePlacement[]; totalHeight: number } {
  const BASE_RADIUS = 90;
  const MIN_RADIUS = 60;
  const LABEL_MARGIN = 80; // extra margin around radius for labels
  const PAD = 24;

  const largest = components[0]?.files.length ?? 1;

  const radii = components.map((c) => {
    // Scale radius by sqrt of file count relative to the largest.
    const scale = Math.sqrt(c.files.length / largest);
    return Math.max(MIN_RADIUS, Math.round(BASE_RADIUS * scale));
  });

  const placements: CirclePlacement[] = [];
  let x = 0;
  let rowTop = 0;
  let rowMaxDiameter = 0;
  let totalHeight = 0;

  for (let i = 0; i < components.length; i++) {
    const r = radii[i];
    const diameter = (r + LABEL_MARGIN) * 2 + PAD;

    if (x + diameter > maxWidth && i > 0) {
      // Wrap to next row.
      rowTop += rowMaxDiameter;
      x = 0;
      rowMaxDiameter = 0;
    }

    placements.push({
      cx: x + r + LABEL_MARGIN + PAD / 2,
      cy: rowTop + r + LABEL_MARGIN + PAD / 2,
      radius: r,
    });

    x += diameter;
    rowMaxDiameter = Math.max(rowMaxDiameter, diameter);
    totalHeight = rowTop + diameter;
  }

  return { placements, totalHeight };
}

// ── Main component ────────────────────────────────────────────────────────────

export type CodebaseRadialProps = {
  edges: GraphEdge[];
  findings: DiagnosticFinding[];
  files: TreeFile[];
  /** Current ?focus= query param value (for two-way sync). */
  focusParam: string | null;
  /** Called when the user selects a file and wants to focus the tree. */
  onFocusTree: (path: string) => void;
};

const CodebaseRadial: React.FC<CodebaseRadialProps> = ({
  edges,
  findings,
  files,
  focusParam,
  onFocusTree,
}) => {
  const [focusFile, setFocusFile] = useState<string | null>(focusParam ?? null);
  const [hoveredFile, setHoveredFile] = useState<string | null>(null);

  // Keep focusFile in sync with the URL param when it changes externally.
  useMemo(() => {
    if (focusParam !== undefined) setFocusFile(focusParam);
  }, [focusParam]);

  const errorFiles = useMemo(() => {
    const s = new Set<string>();
    for (const f of findings) {
      if (f.severity === 'error') s.add(f.file);
    }
    return s;
  }, [findings]);

  const allFilePaths = useMemo(() => files.map((f) => f.path), [files]);

  const layout = useMemo(
    () => buildRadialLayout(allFilePaths, edges, errorFiles),
    [allFilePaths, edges, errorFiles],
  );

  // Max SVG width — we'll use 1200 as a fixed canvas width, height is computed.
  const SVG_WIDTH = 1200;
  const { placements, totalHeight } = useMemo(
    () => packComponents(layout.components, SVG_WIDTH),
    [layout.components],
  );
  const svgHeight = Math.max(totalHeight, 80);

  const handleFileClick = useCallback((path: string) => {
    setFocusFile((prev) => (prev === path ? null : path));
  }, []);

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
  }, []);

  // Summary counts.
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
          {layout.components.length} component{layout.components.length !== 1 ? 's' : ''} ·{' '}
          {layout.unlinked.files.length} unlinked · {totalEdges} edges
          {brokenCount > 0 && (
            <span style={{ color: 'var(--status-critical)', marginLeft: 6 }}>
              · {brokenCount} broken
            </span>
          )}
        </span>

        {focusFile && (
          <button
            type="button"
            className="btn"
            onClick={clearFocus}
            style={{ fontSize: 'var(--text-sm)', padding: '2px 10px' }}
          >
            Show all
          </button>
        )}

        {/* Legend */}
        <div style={{ display: 'flex', gap: 'var(--sp-3)', marginLeft: 'auto', alignItems: 'center' }}>
          <LegendItem color="var(--ink-4)" label="healthy edge" isDash />
          <LegendItem color="var(--status-critical)" label="broken edge (error)" isDash />
          <LegendItem color="var(--status-critical)" label="error file" />
        </div>
      </div>

      {/* SVG radial canvas */}
      <div
        style={{
          overflowX: 'auto',
          overflowY: 'auto',
          maxHeight: '65vh',
          background: 'var(--surface-panel)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--line-1)',
        }}
        role="img"
        aria-label="Codebase radial map"
      >
        {layout.components.length === 0 && layout.unlinked.files.length === 0 ? (
          <div style={{ padding: 'var(--sp-5)', color: 'var(--ink-3)', fontSize: 'var(--text-sm)' }}>
            No files to display.
          </div>
        ) : (
          <svg
            width={SVG_WIDTH}
            height={svgHeight}
            viewBox={`0 0 ${SVG_WIDTH} ${svgHeight}`}
            style={{ display: 'block' }}
            onClick={(ev) => {
              // Click on canvas background clears focus.
              if (ev.target === ev.currentTarget) clearFocus();
            }}
          >
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
                />
              );
            })}
          </svg>
        )}
      </div>

      {/* Unlinked files */}
      {layout.unlinked.files.length > 0 && (
        <div className="panel" style={{ padding: 'var(--sp-3)' }}>
          <div className="panel__head">
            <h3 className="panel__title" style={{ fontSize: 'var(--text-sm)' }}>
              Unlinked files ({layout.unlinked.files.length})
            </h3>
            <span className="panel__hint">no dependency edges</span>
          </div>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 'var(--sp-1)',
              marginTop: 'var(--sp-2)',
              maxHeight: 140,
              overflowY: 'auto',
            }}
          >
            {layout.unlinked.files.map((f) => (
              <span
                key={f}
                role="button"
                tabIndex={0}
                aria-label={`Unlinked file: ${f}`}
                style={{
                  fontSize: 'var(--text-xs)',
                  fontFamily: 'var(--font-mono)',
                  color: errorFiles.has(f) ? 'var(--status-critical)' : 'var(--ink-3)',
                  background: 'var(--surface-wash)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '2px 6px',
                  cursor: 'pointer',
                  border: focusFile === f ? '1px solid var(--neon-cyan)' : '1px solid transparent',
                }}
                onClick={() => {
                  setFocusFile((prev) => (prev === f ? null : f));
                  onFocusTree(f);
                }}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault();
                    onFocusTree(f);
                  }
                }}
              >
                {f.split('/').pop() ?? f}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Selected file detail strip (when file is in unlinked or for context) */}
      {focusFile && (
        <div
          className="panel"
          style={{
            padding: 'var(--sp-3)',
            borderLeft: `3px solid var(--neon-cyan)`,
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
            focus in tree →
          </button>
        </div>
      )}
    </div>
  );
};

// ── Legend item ───────────────────────────────────────────────────────────────

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
