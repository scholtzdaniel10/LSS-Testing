/**
 * IG-32: Map first-paint from GET /graph/rollup.
 *
 * Folder hubs only. File-kind nodes are dropped (overview still has file
 * dots; rollup does not — never paint those here). Ranking stays in server
 * order (fileCount desc, errors desc, id). No C3 /graph or /tree changes.
 */

import type { GraphOverviewLink, GraphOverviewNode, GraphRollup } from '../api/client';
import { componentRadius, folderKeyOf, LABEL_THRESHOLD, radialPerformanceProfile } from './radialModel';

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

const FOLDER_PREFIX = 'dir:';

export function isRollupFolderNode(node: GraphOverviewNode): boolean {
  return node.kind === 'folder' && node.id.startsWith(FOLDER_PREFIX);
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

export function packHubs(
  hubs: RollupHub[],
  maxWidth: number,
): { placements: HubPlacement[]; totalHeight: number } {
  const PAD = 32;
  const placements: HubPlacement[] = [];
  let x = 0;
  let rowTop = 0;
  let rowMaxDiameter = 0;
  let totalHeight = 0;

  for (let i = 0; i < hubs.length; i++) {
    const hub = hubs[i];
    const r = componentRadius(hub.fileCount);
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
      hub,
    });

    x += diameter;
    rowMaxDiameter = Math.max(rowMaxDiameter, diameter);
    totalHeight = rowTop + diameter;
  }

  return { placements, totalHeight };
}

/** Stroke width for a hub-to-hub chord. Tokens only — width, not colour. */
export function chordStrokeWidth(weight: number): number {
  if (weight <= 1) return 1;
  return Math.min(3, 1 + Math.log2(weight));
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

export { LABEL_THRESHOLD };
