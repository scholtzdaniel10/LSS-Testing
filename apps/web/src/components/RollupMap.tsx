/**
 * IG-32 first-paint: folder hubs from graph/rollup.
 * IG-33 drill: hub click expands neighbourhood files on this canvas.
 * IG-32 visual: Archify-tier spine, calm chords, reach, present, export.
 * No file dots on first paint, no unlinked starfield, no overview payload.
 * Design tokens only. contain:content (do not restore contain:strict).
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GraphOverview, GraphRollup } from '../api/client';
import { prefersReducedMotion } from '../lib/anim';
import { exportMapPng } from '../lib/mapCanvasExport';
import {
  buildDrillMapLayout,
  buildRollupMapLayout,
  chordCurvePath,
  chordPaintOpacity,
  chordStrokeWidth,
  chordTouches,
  hubDisplayRadius,
  hubSpineSegments,
  neighbourhoodReach,
  packHubs,
  placeDrillFiles,
  presentChapters,
  presentDurations,
  reachRoleOf,
  shortFileLabel,
  shouldShowHubLabel,
  type DrillFilePlacement,
  type HubPlacement,
  type PresentChapter,
  type ReachRole,
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
const COLOR_UPSTREAM = 'var(--series-4)';
const COLOR_DOWNSTREAM = 'var(--status-good)';

const SVG_WIDTH = 1400;
const DRILL_WAIT_MS = 8000;

function folderColor(groupKey: string): string {
  return SERIES[groupKey] ?? SERIES.other;
}

function sleep(ms: number, shouldSkip: () => boolean): Promise<void> {
  if (ms <= 0 || shouldSkip()) return Promise.resolve();
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (shouldSkip() || Date.now() - started >= ms) {
        resolve();
        return;
      }
      window.setTimeout(tick, 40);
    };
    window.setTimeout(tick, Math.min(40, ms));
  });
}

export type RollupMapProps = {
  rollup: GraphRollup;
  meta?: RollupPaintMeta;
  focusParam: string | null;
  neighbourhood?: GraphOverview | null;
  drillFocus?: string | null;
  onHubClick?: (id: string) => void;
  onCollapse?: () => void;
};

const RollupMap: React.FC<RollupMapProps> = ({
  rollup,
  meta,
  focusParam,
  neighbourhood = null,
  drillFocus = null,
  onHubClick,
  onCollapse,
}) => {
  const layout = useMemo(() => buildRollupMapLayout(rollup, meta), [rollup, meta]);
  const drillLayout = useMemo(() => {
    if (!neighbourhood || !drillFocus) return null;
    return buildDrillMapLayout(rollup, neighbourhood, drillFocus);
  }, [neighbourhood, drillFocus, rollup]);
  const isDrill = drillLayout != null && drillLayout.files.length > 0;
  const [focusId, setFocusId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [presenting, setPresenting] = useState(false);
  const [presentChapter, setPresentChapter] = useState<PresentChapter | null>(null);
  const [exportHint, setExportHint] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const dragging = useRef(false);
  const didPan = useRef(false);
  const dragStart = useRef<{ mx: number; my: number; px: number; py: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const presentGen = useRef(0);
  const presentSkip = useRef(false);
  const isDrillRef = useRef(isDrill);
  isDrillRef.current = isDrill;
  const onHubClickRef = useRef(onHubClick);
  onHubClickRef.current = onHubClick;
  const onCollapseRef = useRef(onCollapse);
  onCollapseRef.current = onCollapse;

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
  const spines = useMemo(() => hubSpineSegments(placements), [placements]);
  const placeById = useMemo(() => {
    const m = new Map<string, HubPlacement>();
    for (const pl of placements) m.set(pl.hub.id, pl);
    return m;
  }, [placements]);

  const drillHubPlacement = useMemo((): HubPlacement | null => {
    if (!isDrill || !drillLayout?.hub) return null;
    const r = hubDisplayRadius(drillLayout.hub.fileCount, drillLayout.hub.fileCount);
    const cy = Math.max(r + 96, 180);
    return {
      cx: SVG_WIDTH / 2,
      cy,
      radius: r,
      hub: drillLayout.hub,
      labelY: cy + r + 16,
    };
  }, [isDrill, drillLayout]);

  const drillFilePlacements = useMemo((): DrillFilePlacement[] => {
    if (!isDrill || !drillLayout || !drillHubPlacement) return [];
    return placeDrillFiles(
      drillHubPlacement.cx,
      drillHubPlacement.cy,
      drillHubPlacement.radius,
      drillLayout.files,
    );
  }, [isDrill, drillLayout, drillHubPlacement]);

  const drillFileById = useMemo(() => {
    const m = new Map<string, DrillFilePlacement>();
    for (const pl of drillFilePlacements) m.set(pl.file.id, pl);
    return m;
  }, [drillFilePlacements]);

  const drillHeight = useMemo(() => {
    if (!drillHubPlacement) return 0;
    let maxY = drillHubPlacement.labelY + 20;
    for (const pl of drillFilePlacements) {
      maxY = Math.max(maxY, pl.cy + pl.radius, pl.labelY + 12);
    }
    return maxY + 48;
  }, [drillHubPlacement, drillFilePlacements]);

  const svgHeight = Math.max(isDrill ? drillHeight : totalHeight, 80);
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

  useEffect(() => {
    if (drillFocus) setFocusId(drillFocus);
  }, [drillFocus]);

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
  const liveChords = isDrill && drillLayout ? drillLayout.chords : layout.chords;
  const reach = useMemo(
    () => neighbourhoodReach(liveChords, activeId),
    [liveChords, activeId],
  );

  const handleHubClick = useCallback((id: string) => {
    setFocusId((prev) => (prev === id ? null : id));
    onHubClick?.(id);
  }, [onHubClick]);

  const stopPresent = useCallback(() => {
    presentGen.current += 1;
    presentSkip.current = false;
    setPresenting(false);
    setPresentChapter(null);
  }, []);

  const skipPresent = useCallback(() => {
    presentSkip.current = true;
  }, []);

  const startPresent = useCallback(() => {
    const chapters = presentChapters(layout.hubs);
    const gen = presentGen.current + 1;
    presentGen.current = gen;
    presentSkip.current = false;
    setPresenting(true);
    setExportHint(null);
    const durations = presentDurations(prefersReducedMotion());
    const skipped = () => presentGen.current !== gen || presentSkip.current;

    void (async () => {
      for (const chapter of chapters) {
        if (presentGen.current !== gen) return;
        setPresentChapter(chapter);
        if (chapter.id === 'overview') {
          if (isDrillRef.current) onCollapseRef.current?.();
          setFocusId(null);
          await sleep(durations.overviewMs, skipped);
          if (presentGen.current !== gen) return;
          const primary = chapters.find((c) => c.id === 'drill')?.hubId ?? layout.hubs[0]?.id ?? null;
          if (primary) setFocusId(primary);
          await sleep(durations.reachMs, skipped);
        } else if (chapter.id === 'drill' && chapter.hubId) {
          setFocusId(chapter.hubId);
          onHubClickRef.current?.(chapter.hubId);
          const waitStep = durations.overviewMs === 0 || presentSkip.current ? 20 : 120;
          const deadline = Date.now() + (durations.overviewMs === 0 || presentSkip.current ? 400 : DRILL_WAIT_MS);
          while (presentGen.current === gen && !isDrillRef.current && Date.now() < deadline) {
            await sleep(waitStep, () => presentGen.current !== gen);
          }
        }
      }
      if (presentGen.current === gen) setPresenting(false);
    })();
  }, [layout.hubs]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const tag = (ev.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (ev.key === 'Escape' && presenting) {
        ev.preventDefault();
        stopPresent();
        return;
      }
      if ((ev.key === 'f' || ev.key === 'F') && !ev.metaKey && !ev.ctrlKey && !ev.altKey) {
        ev.preventDefault();
        if (presenting) stopPresent();
        else startPresent();
        return;
      }
      if (presenting && (ev.key === 'ArrowRight' || ev.key === 'n' || ev.key === 'N')) {
        ev.preventDefault();
        skipPresent();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [presenting, startPresent, stopPresent, skipPresent]);

  const handleExport = useCallback(async () => {
    const svg = svgRef.current;
    if (!svg) return;
    setExportBusy(true);
    setExportHint(null);
    try {
      const subtitle = isDrill && drillLayout
        ? `${drillLayout.files.length} files around ${drillLayout.hub?.name ?? drillFocus ?? 'folder'}`
        : `${hubCount} folders · ${layout.chords.length} links`;
      const result = await exportMapPng(svg, { title: 'Codebase map', subtitle });
      setExportHint(result === 'copied' ? 'Copied PNG' : 'Downloaded PNG');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not export the map PNG.';
      setExportHint(message);
    } finally {
      setExportBusy(false);
    }
  }, [isDrill, drillLayout, drillFocus, hubCount, layout.chords.length]);

  const layoutFitKey = isDrill
    ? `drill:${drillFocus}:${drillLayout?.files.map((f) => f.id).join(',') ?? ''}`
    : presentChapter
      ? `present:${presentChapter.id}:${focusId ?? ''}`
      : layout.hubs.map((h) => `${h.id}:${h.fileCount}`).join(',');
  const lastFitKey = useRef('');
  const fitTargets = useMemo(() => {
    if (isDrill && drillHubPlacement) {
      const files = activeId
        ? drillFilePlacements.filter((pl) => reach.has(pl.file.id))
        : drillFilePlacements;
      const shown = files.length > 0 ? files : drillFilePlacements;
      return [
        { cx: drillHubPlacement.cx, cy: drillHubPlacement.cy, radius: drillHubPlacement.radius + 24 },
        ...shown.map((pl) => ({ cx: pl.cx, cy: pl.cy, radius: pl.radius + 24 })),
      ];
    }
    if (presentChapter?.id === 'overview' && focusId) {
      const framed = placements.filter((pl) => reach.has(pl.hub.id));
      if (framed.length > 0) {
        return framed.map((pl) => ({ cx: pl.cx, cy: pl.cy, radius: pl.radius + 72 }));
      }
    }
    return placements.map((pl) => ({ cx: pl.cx, cy: pl.cy, radius: pl.radius + 72 }));
  }, [
    isDrill,
    drillHubPlacement,
    drillFilePlacements,
    placements,
    presentChapter,
    focusId,
    reach,
    activeId,
  ]);

  useEffect(() => {
    if (fitTargets.length === 0) {
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
    for (const pl of fitTargets) {
      const margin = pl.radius;
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
  }, [layoutFitKey, fitTargets, svgDisplayHeight, resetView]);

  const summary = isDrill && drillLayout
    ? `${drillLayout.files.length} file${drillLayout.files.length !== 1 ? 's' : ''} around ${drillLayout.hub?.name ?? drillFocus}${drillLayout.hiddenFiles > 0 ? ` · ${drillLayout.hiddenFiles} more ranked out` : ''} · ${drillLayout.chords.length} link${drillLayout.chords.length !== 1 ? 's' : ''}`
    : `${hubCount} folder${hubCount !== 1 ? 's' : ''} · ${layout.chords.length} link${layout.chords.length !== 1 ? 's' : ''}`;

  const presentCaption = presentChapter == null
    ? null
    : presentChapter.id === 'overview'
      ? (focusId ? `Present · reach ${layout.hubs.find((h) => h.id === focusId)?.name ?? 'hub'}` : 'Present · overview')
      : `Present · ${presentChapter.title}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
        <span className="panel__hint">
          {summary}
          {!isDrill && layout.truncated && (
            <span style={{ color: 'var(--ink-3)', marginLeft: 6 }}>
              · truncated
              {layout.hiddenHubs > 0 ? ` · ${layout.hiddenHubs} more folders` : ''}
            </span>
          )}
        </span>
        {presentCaption ? (
          <span className="panel__hint" role="status">{presentCaption}</span>
        ) : null}
        {exportHint ? (
          <span className="panel__hint" role="status">{exportHint}</span>
        ) : null}
        <button
          type="button"
          className="btn"
          onClick={resetView}
          style={{ fontSize: 'var(--text-sm)', padding: '2px 10px' }}
          title="Reset zoom/pan (also double-click canvas)"
        >
          Fit
        </button>
        {presenting ? (
          <>
            <button
              type="button"
              className="btn"
              onClick={skipPresent}
              style={{ fontSize: 'var(--text-sm)', padding: '2px 10px' }}
            >
              Next
            </button>
            <button
              type="button"
              className="btn"
              onClick={stopPresent}
              style={{ fontSize: 'var(--text-sm)', padding: '2px 10px' }}
              aria-pressed={true}
            >
              Stop present
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn"
            onClick={startPresent}
            disabled={hubCount === 0}
            style={{ fontSize: 'var(--text-sm)', padding: '2px 10px' }}
            aria-pressed={false}
            title="Guided overview then one folder drill (F). Escape exits."
          >
            Present
          </button>
        )}
        <button
          type="button"
          className="btn"
          onClick={() => void handleExport()}
          disabled={exportBusy || hubCount === 0}
          style={{ fontSize: 'var(--text-sm)', padding: '2px 10px' }}
          title="Copy or download the current map as PNG"
        >
          {exportBusy ? 'Exporting' : 'Export PNG'}
        </button>
        <div style={{ display: 'flex', gap: 'var(--sp-3)', marginLeft: 'auto', alignItems: 'center' }}>
          <LegendItem color="var(--ink-4)" label="link on focus" />
          <LegendItem color="var(--series-4)" label="upstream" />
          <LegendItem color="var(--status-good)" label="downstream" />
          <LegendItem color="var(--status-critical)" label="errors" />
          <LegendItem color="var(--series-1)" label="folder hub" />
          {isDrill ? <LegendItem color="var(--ink-2)" label="file" /> : null}
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
              {isDrill && drillLayout && drillHubPlacement ? (
                <>
                  {drillLayout.chords.map((chord, i) => {
                    const src = drillFileById.get(chord.source);
                    const tgt = drillFileById.get(chord.target);
                    if (!src || !tgt) return null;
                    const onRoute = chordTouches(chord, activeId);
                    const opacity = chordPaintOpacity(activeId != null, onRoute);
                    return (
                      <path
                        key={`${chord.source}->${chord.target}-${i}`}
                        d={chordCurvePath(src.cx, src.cy, tgt.cx, tgt.cy)}
                        fill="none"
                        stroke={onRoute ? COLOR_EDGE_HOVER : chord.broken ? COLOR_EDGE_BROKEN : COLOR_EDGE_HEALTHY}
                        strokeWidth={onRoute ? chordStrokeWidth(chord.weight) + 0.5 : chordStrokeWidth(chord.weight)}
                        opacity={opacity}
                        pointerEvents="none"
                      />
                    );
                  })}
                  <HubRing
                    placement={drillHubPlacement}
                    focused={drillHubPlacement.hub.id === focusId}
                    hovered={drillHubPlacement.hub.id === hoveredId}
                    showLabel
                    faded={false}
                    reachRole="origin"
                    onClick={() => handleHubClick(drillHubPlacement.hub.id)}
                    onHover={setHoveredId}
                  />
                  {drillFilePlacements.map((pl) => (
                    <FileDot
                      key={pl.file.id}
                      placement={pl}
                      focused={pl.file.id === focusId}
                      hovered={pl.file.id === hoveredId}
                      faded={activeId != null && !reach.has(pl.file.id)}
                      reachRole={reachRoleOf(pl.file.id, activeId, drillLayout.chords)}
                      onHover={setHoveredId}
                      onClick={() => setFocusId((prev) => (prev === pl.file.id ? null : pl.file.id))}
                    />
                  ))}
                </>
              ) : (
                <>
                  {spines.map((spine, i) => (
                    <line
                      key={`spine-${i}`}
                      x1={spine.x1}
                      y1={spine.y}
                      x2={spine.x2}
                      y2={spine.y}
                      stroke="var(--line-1)"
                      strokeWidth={1}
                      opacity={0.55}
                      pointerEvents="none"
                    />
                  ))}
                  {layout.chords.map((chord, i) => {
                    const src = placeById.get(chord.source);
                    const tgt = placeById.get(chord.target);
                    if (!src || !tgt) return null;
                    const onRoute = chordTouches(chord, activeId);
                    const opacity = chordPaintOpacity(activeId != null, onRoute);
                    return (
                      <path
                        key={`${chord.source}->${chord.target}-${i}`}
                        d={chordCurvePath(src.cx, src.cy, tgt.cx, tgt.cy)}
                        fill="none"
                        stroke={onRoute ? COLOR_EDGE_HOVER : chord.broken ? COLOR_EDGE_BROKEN : COLOR_EDGE_HEALTHY}
                        strokeWidth={onRoute ? chordStrokeWidth(chord.weight) + 0.5 : chordStrokeWidth(chord.weight)}
                        opacity={opacity}
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
                      faded={activeId != null && !reach.has(pl.hub.id)}
                      reachRole={reachRoleOf(pl.hub.id, activeId, layout.chords)}
                      onClick={() => handleHubClick(pl.hub.id)}
                      onHover={setHoveredId}
                    />
                  ))}
                </>
              )}
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
  reachRole,
  onClick,
  onHover,
}: {
  placement: HubPlacement;
  focused: boolean;
  hovered: boolean;
  showLabel: boolean;
  faded: boolean;
  reachRole: ReachRole;
  onClick: () => void;
  onHover: (id: string | null) => void;
}) {
  const { cx, cy, radius, hub, labelY } = placement;
  const color = focused || reachRole === 'origin' ? COLOR_FOCUS : folderColor(hub.groupKey);
  const ringStroke = hub.errors > 0
    ? COLOR_EDGE_BROKEN
    : reachRole === 'upstream'
      ? COLOR_UPSTREAM
      : reachRole === 'downstream'
        ? COLOR_DOWNSTREAM
        : focused || hovered
          ? COLOR_FOCUS
          : 'var(--line-2)';
  const strokeWidth = focused || reachRole === 'origin' ? 2 : hub.errors > 0 || reachRole !== 'none' ? 1.5 : 1;

  return (
    <g
      opacity={faded ? 0.22 : 1}
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
      {focused || reachRole === 'origin' ? (
        <circle
          cx={cx}
          cy={cy}
          r={radius + 6}
          fill="none"
          stroke={COLOR_FOCUS}
          strokeWidth={1}
          pointerEvents="none"
        />
      ) : null}
      <circle
        cx={cx}
        cy={cy}
        r={radius}
        fill="var(--surface-raised)"
        stroke={ringStroke}
        strokeWidth={strokeWidth}
        pointerEvents="none"
      />
      <circle cx={cx} cy={cy} r={radius} fill="transparent" pointerEvents="all" />
      <text
        x={cx}
        y={cy}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="var(--text-xs)"
        fontFamily="var(--font-mono)"
        fill="var(--ink-3)"
        style={{ userSelect: 'none', pointerEvents: 'none' }}
      >
        {hub.fileCount}
      </text>
      {showLabel && (
        <text
          x={cx}
          y={labelY}
          textAnchor="middle"
          fontSize="var(--text-sm)"
          fontFamily="var(--font-mono)"
          fontWeight={600}
          fill={color}
          style={{ userSelect: 'none', pointerEvents: 'none' }}
        >
          {shortFileLabel(hub.name.replace(/\/$/, ''), 16)}
        </text>
      )}
    </g>
  );
});

const FileDot = memo(function FileDot({
  placement,
  focused,
  hovered,
  faded,
  reachRole,
  onHover,
  onClick,
}: {
  placement: DrillFilePlacement;
  focused: boolean;
  hovered: boolean;
  faded: boolean;
  reachRole: ReachRole;
  onHover: (id: string | null) => void;
  onClick: () => void;
}) {
  const { cx, cy, radius, file, labelX, labelY, textAnchor } = placement;
  const fill = file.errors > 0
    ? 'var(--status-critical)'
    : focused || hovered || reachRole === 'origin'
      ? COLOR_FOCUS
      : reachRole === 'upstream'
        ? COLOR_UPSTREAM
        : reachRole === 'downstream'
          ? COLOR_DOWNSTREAM
          : folderColor(file.groupKey);
  const r = hovered || focused || reachRole === 'origin' ? radius + 1.5 : radius;

  return (
    <g
      opacity={faded ? 0.22 : 1}
      style={{ cursor: 'pointer' }}
      onMouseEnter={() => onHover(file.id)}
      onMouseLeave={() => onHover(null)}
      onClick={onClick}
      onKeyDown={(ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          onClick();
        }
      }}
      tabIndex={0}
      role="button"
      aria-pressed={focused}
      aria-label={`File: ${file.id}${file.errors > 0 ? ` (${file.errors} errors)` : ''}`}
    >
      <title>{file.id}</title>
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill={fill}
        stroke={focused || hovered || reachRole !== 'none' ? COLOR_FOCUS : 'var(--line-1)'}
        strokeWidth={focused || reachRole === 'origin' ? 1.5 : 0.75}
      />
      <text
        x={labelX}
        y={labelY}
        textAnchor={textAnchor}
        dominantBaseline="middle"
        fontSize="var(--text-xs)"
        fontFamily="var(--font-mono)"
        fill="var(--ink-2)"
        style={{ userSelect: 'none', pointerEvents: 'none' }}
      >
        {shortFileLabel(file.name)}
      </text>
    </g>
  );
});

function LegendItem({
  color,
  label,
}: {
  color: string;
  label: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <svg width={8} height={8} aria-hidden>
        <circle cx={4} cy={4} r={3.5} fill="none" stroke={color} strokeWidth={1.25} />
      </svg>
      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)' }}>{label}</span>
    </div>
  );
}

export default RollupMap;
