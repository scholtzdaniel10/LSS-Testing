/**
 * IG-32: Map first-paint from GET /graph/rollup.
 * IG-33: drill layout from GET /graph/neighbourhood (file dots around the hub).
 *
 * Folder hubs only on first paint. File-kind nodes are dropped from rollup
 * (overview still has file dots; rollup does not — never paint those here).
 * Ranking stays in server order (fileCount desc, errors desc, id).
 * No C3 /graph or /tree changes.
 */

import type { GraphOverview, GraphOverviewLink, GraphOverviewNode, GraphRollup } from '../api/client';
import { folderKeyOf, LABEL_THRESHOLD, radialPerformanceProfile } from './radialModel';

export type RollupHub = {
  id: string;
  name: string;
  folderPath: string;
  groupKey: string;
  fileCount: number;
  errors: number;
  degree: number;
};

export type RollupChord = {
  source: string;
  target: string;
  weight: number;
  broken: boolean;
};

export type HubPlacement = {
  cx: number;
  cy: number;
  radius: number;
  hub: RollupHub;
  labelY: number;
};

export type DrillFile = {
  id: string;
  name: string;
  groupKey: string;
  errors: number;
  degree: number;
};

export type DrillFilePlacement = {
  cx: number;
  cy: number;
  radius: number;
  file: DrillFile;
  labelX: number;
  labelY: number;
  textAnchor: 'start' | 'middle' | 'end';
};

export type DrillMapLayout = {
  hub: RollupHub | null;
  files: DrillFile[];
  chords: RollupChord[];
  /** Files ranked out of the drill cap (server neighbourhood still complete). */
  hiddenFiles: number;
};

export type RollupMapLayout = {
  hubs: RollupHub[];
  chords: RollupChord[];
  /** Hubs hidden by the client circle cap (server order preserved). */
  hiddenHubs: number;
  truncated: boolean;
};

export type RollupPaintMeta = {
  total?: unknown;
  returned?: unknown;
  truncated?: unknown;
  cap?: unknown;
  reason?: unknown;
};

export type PresentChapter = {
  id: 'overview' | 'drill';
  title: string;
  hubId: string | null;
};

const FOLDER_PREFIX = 'dir:';
export const FILE_DOT_RADIUS = 6;
export const DRILL_FILE_CAP = 12;
const ORBIT_MIN_ARC = 52;
const ORBIT_GAP = 36;
const HUB_MIN_RADIUS = 28;
const HUB_MAX_RADIUS = 72;
const HUB_GAP = 56;
const ROW_GAP = 64;
const LABEL_BAND = 44;
const PAD_X = 48;
const PAD_Y = 56;
const WHISPER_CHORD = 0.05;
const ROUTE_CHORD = 0.92;
const IDLE_CHORD = 0.04;

export function isRollupFolderNode(node: GraphOverviewNode): boolean {
  return node.kind === 'folder' && !node.external && node.id.startsWith(FOLDER_PREFIX);
}

export function isDrillFileNode(node: GraphOverviewNode): boolean {
  return node.kind === 'file' && !node.external;
}

function asHub(node: GraphOverviewNode): RollupHub {
  const folderPath = node.folderPath ?? node.id.slice(FOLDER_PREFIX.length);
  return {
    id: node.id,
    name: node.name,
    folderPath,
    groupKey: folderKeyOf(folderPath),
    fileCount: node.fileCount,
    errors: node.errors,
    degree: node.degree,
  };
}

/**
 * Convert a rollup payload into packed hub rings. Drops file/external nodes
 * and any chord that does not join two kept folders.
 */
export function buildRollupMapLayout(
  rollup: GraphRollup,
  meta?: RollupPaintMeta,
): RollupMapLayout {
  const hubs: RollupHub[] = [];
  for (const node of rollup.nodes) {
    if (!isRollupFolderNode(node)) continue;
    hubs.push(asHub(node));
  }

  const fileCountSum = hubs.reduce((sum, hub) => sum + hub.fileCount, 0);
  const profile = radialPerformanceProfile(fileCountSum);
  const maxCircles = Number.isFinite(profile.maxCircles) ? profile.maxCircles : hubs.length;
  const visible = hubs.slice(0, maxCircles);
  const keep = new Set(visible.map((hub) => hub.id));
  const hiddenHubs = hubs.length - visible.length;

  const errorById = new Map(visible.map((hub) => [hub.id, hub.errors > 0]));
  const chords: RollupChord[] = [];
  for (const link of rollup.links) {
    const chord = chordFromLink(link, keep, errorById);
    if (chord) chords.push(chord);
  }

  const serverTruncated = meta?.truncated === true;
  return {
    hubs: visible,
    chords,
    hiddenHubs,
    truncated: serverTruncated || hiddenHubs > 0,
  };
}

function chordFromLink(
  link: GraphOverviewLink,
  keep: ReadonlySet<string>,
  errorById: ReadonlyMap<string, boolean>,
): RollupChord | null {
  if (!keep.has(link.source) || !keep.has(link.target)) return null;
  if (link.source === link.target) return null;
  return {
    source: link.source,
    target: link.target,
    weight: link.weight,
    broken: errorById.get(link.source) === true || errorById.get(link.target) === true,
  };
}

/** Size hubs by relative fileCount so the spine reads as hierarchy, not packed rings. */
export function hubDisplayRadius(fileCount: number, maxFileCount: number): number {
  if (maxFileCount <= 0) return HUB_MIN_RADIUS;
  const t = Math.sqrt(Math.max(0, fileCount) / maxFileCount);
  return Math.round(HUB_MIN_RADIUS + (HUB_MAX_RADIUS - HUB_MIN_RADIUS) * Math.min(1, t));
}

/**
 * Architecture spine: ranked hubs left-to-right with generous gaps, wrapping
 * to a new row rather than packing circles. Server order is preserved.
 */
export function packHubs(
  hubs: RollupHub[],
  maxWidth: number,
): { placements: HubPlacement[]; totalHeight: number } {
  const maxFiles = hubs.reduce((n, hub) => Math.max(n, hub.fileCount), 0);
  const sized = hubs.map((hub) => ({ hub, radius: hubDisplayRadius(hub.fileCount, maxFiles) }));
  const innerWidth = Math.max(240, maxWidth - PAD_X * 2);

  type Row = { items: typeof sized; width: number; height: number };
  const rows: Row[] = [];
  let current: Row = { items: [], width: 0, height: 0 };

  for (const item of sized) {
    const cell = item.radius * 2 + HUB_GAP;
    if (current.items.length > 0 && current.width + cell > innerWidth) {
      rows.push(current);
      current = { items: [], width: 0, height: 0 };
    }
    current.items.push(item);
    current.width += cell;
    current.height = Math.max(current.height, item.radius * 2 + LABEL_BAND);
  }
  if (current.items.length > 0) rows.push(current);

  const placements: HubPlacement[] = [];
  let rowTop = PAD_Y;
  let totalHeight = PAD_Y;

  for (const row of rows) {
    const contentW = row.items.reduce((w, item, i) => w + item.radius * 2 + (i > 0 ? HUB_GAP : 0), 0);
    const rowRadius = row.items.reduce((r, item) => Math.max(r, item.radius), 0);
    let x = PAD_X + Math.max(0, (innerWidth - contentW) / 2);
    for (const item of row.items) {
      const cx = x + item.radius;
      const cy = rowTop + rowRadius;
      placements.push({
        cx,
        cy,
        radius: item.radius,
        hub: item.hub,
        labelY: cy + item.radius + 16,
      });
      x += item.radius * 2 + HUB_GAP;
    }
    rowTop += row.height + ROW_GAP;
    totalHeight = rowTop;
  }

  return { placements, totalHeight: Math.max(totalHeight, PAD_Y * 2) };
}

export type SpineSegment = { x1: number; x2: number; y: number };

/** Hairline through each packed row — architecture spine, not a data series. */
export function hubSpineSegments(placements: HubPlacement[]): SpineSegment[] {
  const rows: Array<{ minX: number; maxX: number; y: number }> = [];
  for (const pl of placements) {
    const left = pl.cx - pl.radius;
    const right = pl.cx + pl.radius;
    const existing = rows.find((row) => Math.abs(row.y - pl.cy) <= 8);
    if (!existing) {
      rows.push({ minX: left, maxX: right, y: pl.cy });
    } else {
      existing.minX = Math.min(existing.minX, left);
      existing.maxX = Math.max(existing.maxX, right);
    }
  }
  return rows.map((row) => ({ x1: row.minX, x2: row.maxX, y: row.y }));
}

/** Quadratic lift so chords read as routes, not a hairball of straight lines. */
export function chordCurvePath(x1: number, y1: number, x2: number, y2: number): string {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const lift = Math.min(72, Math.max(18, len * 0.2));
  const cx = mx - (dy / len) * lift;
  const cy = my + (dx / len) * lift;
  return `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;
}

/** Stroke width for a hub-to-hub chord. Tokens only — width, not colour. */
export function chordStrokeWidth(weight: number): number {
  if (weight <= 1) return 1.25;
  return Math.min(2.75, 1.25 + Math.log2(weight) * 0.55);
}

export function chordPaintOpacity(hasFocus: boolean, onRoute: boolean): number {
  if (!hasFocus) return WHISPER_CHORD;
  return onRoute ? ROUTE_CHORD : IDLE_CHORD;
}

/**
 * One-hop neighbourhood of `focusId` using only payload chords.
 * Does not invent edges.
 */
export function neighbourhoodReach(
  chords: RollupChord[],
  focusId: string | null,
): Set<string> {
  const reach = new Set<string>();
  if (focusId == null || focusId === '') return reach;
  reach.add(focusId);
  for (const chord of chords) {
    if (chord.source === focusId) reach.add(chord.target);
    if (chord.target === focusId) reach.add(chord.source);
  }
  return reach;
}

export function chordTouches(chord: RollupChord, id: string | null): boolean {
  return id != null && (chord.source === id || chord.target === id);
}

export type ReachRole = 'origin' | 'upstream' | 'downstream' | 'none';

/**
 * Directed 1-hop role from payload chords only. Downstream = origin→id,
 * upstream = id→origin. Does not invent edges.
 */
export function reachRoleOf(id: string, originId: string | null, chords: RollupChord[]): ReachRole {
  if (originId == null) return 'none';
  if (id === originId) return 'origin';
  let upstream = false;
  let downstream = false;
  for (const chord of chords) {
    if (chord.source === originId && chord.target === id) downstream = true;
    if (chord.target === originId && chord.source === id) upstream = true;
  }
  if (downstream && !upstream) return 'downstream';
  if (upstream && !downstream) return 'upstream';
  if (upstream || downstream) return 'downstream';
  return 'none';
}

export function shouldShowHubLabel(
  hubCount: number,
  hubId: string,
  focusId: string | null,
  hoveredId: string | null,
): boolean {
  if (hubCount <= LABEL_THRESHOLD) return true;
  return hubId === focusId || hubId === hoveredId;
}

function asDrillFile(node: GraphOverviewNode): DrillFile {
  const folderPath = node.id.includes('/') ? node.id.slice(0, node.id.lastIndexOf('/')) : '';
  return {
    id: node.id,
    name: node.name,
    groupKey: folderKeyOf(folderPath || node.folder),
    errors: node.errors,
    degree: node.degree,
  };
}

/** Rank neighbourhood files so the drill is a labeled shortlist, not a starfield. */
export function rankDrillFiles(files: DrillFile[]): { visible: DrillFile[]; hidden: number } {
  const ranked = [...files].sort((a, b) => {
    if (b.errors !== a.errors) return b.errors - a.errors;
    if (b.degree !== a.degree) return b.degree - a.degree;
    return a.id.localeCompare(b.id);
  });
  const visible = ranked.slice(0, DRILL_FILE_CAP);
  return { visible, hidden: ranked.length - visible.length };
}

export function shortFileLabel(name: string, max = 18): string {
  if (name.length <= max) return name;
  return `${name.slice(0, Math.max(1, max - 1))}…`;
}

/**
 * Drill paint from GET /graph/neighbourhood. File nodes only; the clicked
 * rollup hub is kept as the centre. First-paint rollup layout is unchanged.
 */
export function buildDrillMapLayout(
  rollup: GraphRollup,
  neighbourhood: GraphOverview,
  focusId: string,
): DrillMapLayout {
  const hubNode = rollup.nodes.find((node) => node.id === focusId && isRollupFolderNode(node));
  const hub = hubNode ? asHub(hubNode) : null;
  const files: DrillFile[] = [];
  for (const node of neighbourhood.nodes) {
    if (!isDrillFileNode(node)) continue;
    files.push(asDrillFile(node));
  }
  const { visible, hidden } = rankDrillFiles(files);
  const keep = new Set(visible.map((file) => file.id));
  const errorById = new Map(visible.map((file) => [file.id, file.errors > 0]));
  const chords: RollupChord[] = [];
  for (const link of neighbourhood.links) {
    const chord = chordFromLink(link, keep, errorById);
    if (chord) chords.push(chord);
  }
  return { hub, files: visible, chords, hiddenFiles: hidden };
}

/** Place `count` dots on a ring around (cx, cy). Grows the radius to keep min arc. */
export function placeOrbit(
  cx: number,
  cy: number,
  innerRadius: number,
  count: number,
  dotRadius = FILE_DOT_RADIUS,
): Array<{ cx: number; cy: number }> {
  if (count <= 0) return [];
  const minR = innerRadius + dotRadius + ORBIT_GAP;
  const fromArc = Math.ceil((count * ORBIT_MIN_ARC) / (2 * Math.PI));
  const r = Math.max(minR, fromArc);
  const out: Array<{ cx: number; cy: number }> = [];
  for (let i = 0; i < count; i++) {
    const angle = (2 * Math.PI * i) / count;
    out.push({
      cx: cx + r * Math.sin(angle),
      cy: cy - r * Math.cos(angle),
    });
  }
  return out;
}

export function placeDrillFiles(
  hubCx: number,
  hubCy: number,
  hubRadius: number,
  files: DrillFile[],
): DrillFilePlacement[] {
  const pts = placeOrbit(hubCx, hubCy, hubRadius, files.length);
  return files.map((file, i) => {
    const pt = pts[i];
    const dx = pt.cx - hubCx;
    const dy = pt.cy - hubCy;
    const dist = Math.hypot(dx, dy) || 1;
    const labelR = dist + 16;
    const sin = dx / dist;
    const textAnchor: 'start' | 'middle' | 'end' = sin > 0.28 ? 'start' : sin < -0.28 ? 'end' : 'middle';
    return {
      cx: pt.cx,
      cy: pt.cy,
      radius: FILE_DOT_RADIUS,
      file,
      labelX: hubCx + (dx / dist) * labelR,
      labelY: hubCy + (dy / dist) * labelR,
      textAnchor,
    };
  });
}

/**
 * Finite present story: overview of live rollup hubs, then one drill chapter
 * on the first (server-ranked) hub. No extra fetches until the drill chapter.
 */
export function presentChapters(hubs: RollupHub[]): PresentChapter[] {
  const overview: PresentChapter = { id: 'overview', title: 'Folders', hubId: null };
  const primary = hubs[0];
  if (!primary) return [overview];
  return [
    overview,
    { id: 'drill', title: primary.name, hubId: primary.id },
  ];
}

export function presentDurations(reducedMotion: boolean): { overviewMs: number; reachMs: number } {
  if (reducedMotion) return { overviewMs: 0, reachMs: 0 };
  return { overviewMs: 1200, reachMs: 700 };
}

export { LABEL_THRESHOLD };
