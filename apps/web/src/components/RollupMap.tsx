/**
 * IG-32 first-paint: folder rings from graph/rollup.
 * No file dots, no unlinked starfield, no overview payload.
 * Design tokens only. contain:content (do not restore contain:strict).
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GraphRollup } from '../api/client';
import {
  buildRollupMapLayout,
  chordStrokeWidth,
  packHubs,
  shouldShowHubLabel,
  type HubPlacement,
  type RollupChord,
  type RollupPaintMeta,
} from '../lib/rollupMapModel';

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

const COLOR_EDGE_HEALTHY = 'var(--ink-4)';
const COLOR_EDGE_BROKEN = 'var(--status-critical)';
const COLOR_EDGE_HOVER = 'var(--neon-cyan)';
const COLOR_FOCUS = 'var(--neon-cyan)';

const SVG_WIDTH = 1400;

function folderColor(groupKey: string): string {
  return SERIES[groupKey] ?? SERIES.other;
}

export type RollupMapProps = {
  rollup: GraphRollup;
  meta?: RollupPaintMeta;
  focusParam: string | null;
  onSelectFolder: (folderPath: string) => void;
};

const RollupMap: React.FC<RollupMapProps> = ({ rollup, meta, focusParam, onSelectFolder }) => {
  const layout = useMemo(() => buildRollupMapLayout(rollup, meta), [rollup, meta]);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const dragging = useRef(false);
  const didPan = useRef(false);
  const dragStart = useRef<{ mx: number; my: number; px: number; py: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const resetView = useCallback(() => {
    setZoom(1);
    setPanX(0);
    setPanY(0);
  }, []);

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

  const { placements, totalHeight } = useMemo(
    () => packHubs(layout.hubs, SVG_WIDTH),
    [layout.hubs],
  );
  const placeById = useMemo(() => {
    const m = new Map<string, HubPlacement>();
    for (const pl of placements) m.set(pl.hub.id, pl);
    return m;
  }, [placements]);

  const svgHeight = Math.max(totalHeight, 80);
  const svgDisplayHeight = typeof window !== 'undefined'
    ? Math.min(svgHeight, window.innerHeight * 0.65)
    : svgHeight;

  useEffect(() => {
    if (focusParam) {
      const match = layout.hubs.find(
        (h) => h.folderPath === focusParam || h.id === focusParam || h.folderPath === focusParam.replace(/\/$/, ''),
      );
      setFocusId(match?.id ?? null);
    }
  }, [focusParam, layout.hubs]);

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

  const activeId = focusId ?? hoveredId;
  const hubCount = layout.hubs.length;

  const chordTouches = (chord: RollupChord, id: string | null) =>
    id != null && (chord.source === id || chord.target === id);

  const handleHubClick = useCallback((folderPath: string, id: string) => {
    setFocusId((prev) => (prev === id ? null : id));
    onSelectFolder(folderPath);
  }, [onSelectFolder]);

  const layoutFitKey = layout.hubs.map((h) => `${h.id}:${h.fileCount}`).join(',');
  const lastFitKey = useRef('');

  useEffect(() => {
    if (placements.length === 0) {
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
  }, [layoutFitKey, placements, svgDisplayHeight, resetView]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
        <span className="panel__hint">
          {hubCount} folder{hubCount !== 1 ? 's' : ''} &middot; {layout.chords.length} link
          {layout.chords.length !== 1 ? 's' : ''}
          {layout.truncated && (
            <span style={{ color: 'var(--ink-3)', marginLeft: 6 }}>
              &middot; truncated
              {layout.hiddenHubs > 0 ? ` · ${layout.hiddenHubs} more folders` : ''}
            </span>
          )}
        </span>
        <button
          type="button"
          className="btn"
          onClick={resetView}
          style={{ fontSize: 'var(--text-sm)', padding: '2px 10px' }}
          title="Reset zoom/pan (also double-click canvas)"
        >
          Fit
        </button>
        <div style={{ display: 'flex', gap: 'var(--sp-3)', marginLeft: 'auto', alignItems: 'center' }}>
          <LegendItem color="var(--ink-4)" label="folder link" isDash />
          <LegendItem color="var(--status-critical)" label="errors in folder" isDash />
          <LegendItem color="var(--series-1)" label="folder hub" />
        </div>
      </div>

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
          contain: 'content',
        }}
        role="img"
        aria-label="Codebase folder map"
      >
        {layout.hubs.length === 0 ? (
          <div style={{ padding: 'var(--sp-5)', color: 'var(--ink-3)', fontSize: 'var(--text-sm)' }}>
            No folders to display.
          </div>
        ) : (
          <svg
            ref={svgRef}
            width="100%"
            height={svgDisplayHeight}
            viewBox={`0 0 ${SVG_WIDTH} ${svgDisplayHeight}`}
            style={{ display: 'block', touchAction: 'none', contain: 'layout style paint' }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onDoubleClick={(ev) => {
              if ((ev.target as Element).closest('[role="button"]')) return;
              resetView();
            }}
            onClick={(ev) => {
              if (ev.target === ev.currentTarget) setFocusId(null);
            }}
          >
            <g transform={`scale(${zoom}) translate(${panX},${panY})`}>
              {layout.chords.map((chord, i) => {
                const src = placeById.get(chord.source);
                const tgt = placeById.get(chord.target);
                if (!src || !tgt) return null;
                const active = chordTouches(chord, activeId);
                const faded = activeId != null && !active;
                return (
                  <line
                    key={`${chord.source}->${chord.target}-${i}`}
                    x1={src.cx}
                    y1={src.cy}
                    x2={tgt.cx}
                    y2={tgt.cy}
                    stroke={active ? COLOR_EDGE_HOVER : chord.broken ? COLOR_EDGE_BROKEN : COLOR_EDGE_HEALTHY}
                    strokeWidth={chordStrokeWidth(chord.weight)}
                    opacity={faded ? 0.08 : active ? 0.9 : chord.broken ? 0.55 : 0.28}
                    pointerEvents="none"
                  />
                );
              })}
              {placements.map((pl) => (
                <HubRing
                  key={pl.hub.id}
                  placement={pl}
                  focused={pl.hub.id === focusId}
                  hovered={pl.hub.id === hoveredId}
                  showLabel={shouldShowHubLabel(hubCount, pl.hub.id, focusId, hoveredId)}
                  faded={activeId != null && pl.hub.id !== activeId && !layout.chords.some((c) =>
                    chordTouches(c, activeId) && (c.source === pl.hub.id || c.target === pl.hub.id),
                  )}
                  onClick={() => handleHubClick(pl.hub.folderPath, pl.hub.id)}
                  onHover={setHoveredId}
                />
              ))}
            </g>
          </svg>
        )}
      </div>
    </div>
  );
};

const HubRing = memo(function HubRing({
  placement,
  focused,
  hovered,
  showLabel,
  faded,
  onClick,
  onHover,
}: {
  placement: HubPlacement;
  focused: boolean;
  hovered: boolean;
  showLabel: boolean;
  faded: boolean;
  onClick: () => void;
  onHover: (id: string | null) => void;
}) {
  const { cx, cy, radius, hub } = placement;
  const color = focused ? COLOR_FOCUS : folderColor(hub.groupKey);
  const ringStroke = hub.errors > 0 ? COLOR_EDGE_BROKEN : 'var(--line-1)';

  return (
    <g
      opacity={faded ? 0.28 : 1}
      style={{ cursor: 'pointer' }}
      onClick={onClick}
      onMouseEnter={() => onHover(hub.id)}
      onMouseLeave={() => onHover(null)}
      onKeyDown={(ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          onClick();
        }
      }}
      tabIndex={0}
      role="button"
      aria-label={`Folder: ${hub.folderPath}/ (${hub.fileCount} files${hub.errors > 0 ? `, ${hub.errors} errors` : ''})`}
      aria-pressed={focused}
    >
      <circle
        cx={cx}
        cy={cy}
        r={radius}
        fill="none"
        stroke={focused || hovered ? COLOR_FOCUS : ringStroke}
        strokeWidth={focused ? 1.5 : hub.errors > 0 ? 1.25 : 0.5}
        strokeDasharray="3 6"
        pointerEvents="none"
      />
      <circle cx={cx} cy={cy} r={radius} fill="transparent" pointerEvents="all" />
      {showLabel && (
        <text
          x={cx}
          y={cy}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="var(--text-sm)"
          fontFamily="var(--font-mono)"
          fontWeight={600}
          fill={color}
          style={{ userSelect: 'none', pointerEvents: 'none' }}
        >
          {hub.name}
        </text>
      )}
    </g>
  );
});

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
          <circle cx={4} cy={4} r={3.5} fill="none" stroke={color} strokeWidth={1} strokeDasharray="2 1" />
        </svg>
      )}
      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)' }}>{label}</span>
    </div>
  );
}

export default RollupMap;
