/**
 * IG-32: live GET /graph/rollup (and neighbourhood on drill) → Archify
 * architecture JSON IR. Connections are payload edges only — never invented.
 *
 * Layout is authored judgment from payload topology (sources left, sinks
 * right), not a uniform 4-col wrap. Archify rejects auto-layout grids.
 */

import type { GraphOverview, GraphRollup } from '../api/client';
import {
  buildDrillMapLayout,
  buildRollupMapLayout,
  chordStrokeWidth,
  type DrillFile,
  type RollupChord,
  type RollupHub,
  type RollupPaintMeta,
} from './rollupMapModel';

export type ArchifyComponentType =
  | 'frontend'
  | 'backend'
  | 'database'
  | 'cloud'
  | 'security'
  | 'messagebus'
  | 'external';

export type ArchifyArchitectureIR = {
  schema_version: 1;
  diagram_type: 'architecture';
  meta: {
    title: string;
    subtitle: string;
    visual_preset: 'signal-flow';
    quality_profile: 'showcase';
    animation: 'trace' | 'none';
    views?: Array<{ id: string; label: string; focus: string[]; note?: string }>;
  };
  layout: {
    mode: 'grid';
    origin: [number, number];
    cols: number;
    gapX: number;
    gapY: number;
    cellW: number;
    cellH: number;
  };
  components: Array<{
    id: string;
    type: ArchifyComponentType;
    label: string;
    sublabel?: string;
    tag?: string;
    row: number;
    col: number;
    size: [number, number];
  }>;
  boundaries: Array<{ kind: 'region'; label: string; wraps: string[] }>;
  connections: Array<{
    id: string;
    from: string;
    to: string;
    variant: 'default' | 'emphasis' | 'security' | 'dashed';
    width: number;
    fromSide?: 'left' | 'right' | 'top' | 'bottom';
    toSide?: 'left' | 'right' | 'top' | 'bottom';
    route?: 'auto' | 'straight' | 'orthogonal-h' | 'orthogonal-v';
  }>;
  cards: Array<{
    dot: 'cyan' | 'emerald' | 'rose';
    title: string;
    items: string[];
  }>;
};

export type ArchifyMapModel = {
  diagram: ArchifyArchitectureIR;
  sourceByIrId: Record<string, string>;
  irIdBySource: Record<string, string>;
  kindByIrId: Record<string, 'folder' | 'file'>;
};

export const DRILL_FILE_CAP = 12;
const LABEL_MAX = 16;
const CARD_SIZE: [number, number] = [140, 64];
const FOCUS_CARD_SIZE: [number, number] = [140, 64];

const TYPE_BY_GROUP: Record<string, ArchifyComponentType> = {
  app: 'frontend',
  application: 'frontend',
  routes: 'frontend',
  resources: 'frontend',
  database: 'database',
  system: 'cloud',
  config: 'cloud',
  configs: 'cloud',
  src: 'backend',
  lib: 'backend',
  tests: 'security',
  test: 'security',
  other: 'backend',
};

export function irIdFromSource(sourceId: string): string {
  let base = sourceId.startsWith('dir:')
    ? `folder_${sourceId.slice(4)}`
    : `file_${sourceId}`;
  base = base.replace(/[^a-zA-Z0-9_-]/g, '_');
  if (!/^[a-zA-Z]/.test(base)) base = `n_${base}`;
  return base.slice(0, 48);
}

function uniqueIrId(sourceId: string, used: Set<string>): string {
  const base = irIdFromSource(sourceId);
  let id = base;
  let n = 2;
  while (used.has(id)) {
    id = `${base}_${n++}`.slice(0, 64);
  }
  used.add(id);
  return id;
}

function fitLabel(raw: string): string {
  const text = raw.replace(/\/+$/, '') || raw;
  if (text.length <= LABEL_MAX) return text;
  return `${text.slice(0, LABEL_MAX - 1)}…`;
}

function typeForFolder(pathOrKey: string): ArchifyComponentType {
  const top = (pathOrKey.split('/')[0] ?? pathOrKey).toLowerCase();
  return TYPE_BY_GROUP[top] ?? 'backend';
}

function connectionVariant(chord: RollupChord): 'default' | 'emphasis' | 'security' {
  if (chord.broken) return 'security';
  if (chord.weight >= 5) return 'emphasis';
  return 'default';
}

type GridCell = { row: number; col: number };

function archifyGrid(cols: number): ArchifyArchitectureIR['layout'] {
  return {
    mode: 'grid',
    origin: [56, 96],
    cols,
    gapX: 64,
    gapY: 56,
    cellW: 140,
    cellH: 64,
  };
}

function parentAmong(id: string, ids: Set<string>): string | null {
  const folderPath = id.startsWith('dir:')
    ? id.slice(4)
    : id.includes('/')
      ? id.slice(0, id.lastIndexOf('/'))
      : '';
  if (!folderPath) return null;
  const parts = folderPath.split('/').filter(Boolean);
  while (parts.length > 0) {
    const parentDir = `dir:${parts.join('/')}`;
    if (parentDir !== id && ids.has(parentDir)) return parentDir;
    if (ids.has(parts.join('/'))) return parts.join('/');
    parts.pop();
  }
  return null;
}

function placeOnGrid(sourceIds: string[], colsCap = 4): Map<string, GridCell> {
  const cols = Math.min(colsCap, Math.max(1, sourceIds.length));
  const cells = new Map<string, GridCell>();
  sourceIds.forEach((id, i) => {
    cells.set(id, { row: Math.floor(i / cols), col: i % cols });
  });
  return cells;
}

/** Longest-path columns from payload edges only — sources left, sinks right. */
function placeByFlow(sourceIds: string[], chords: RollupChord[]): Map<string, GridCell> {
  const idSet = new Set(sourceIds);
  const index = new Map(sourceIds.map((id, i) => [id, i]));
  const outgoing = new Map<string, string[]>(sourceIds.map((id) => [id, []]));
  const indegree = new Map<string, number>(sourceIds.map((id) => [id, 0]));
  const seenDir = new Set<string>();
  for (const chord of chords) {
    if (!idSet.has(chord.source) || !idSet.has(chord.target) || chord.source === chord.target) continue;
    const dir = `${chord.source}>${chord.target}`;
    if (seenDir.has(dir)) continue;
    seenDir.add(dir);
    outgoing.get(chord.source)!.push(chord.target);
    indegree.set(chord.target, (indegree.get(chord.target) ?? 0) + 1);
  }

  const connected = sourceIds.filter(
    (id) => (outgoing.get(id)?.length ?? 0) > 0 || (indegree.get(id) ?? 0) > 0,
  );
  if (connected.length === 0) return placeOnGrid(sourceIds, 4);

  const isolates = sourceIds.filter((id) => !connected.includes(id));
  const rank = new Map<string, number>(connected.map((id) => [id, 0]));
  const remaining = new Map(connected.map((id) => [id, indegree.get(id) ?? 0]));
  const queue = connected.filter((id) => remaining.get(id) === 0);
  const processed = new Set<string>();
  while (queue.length > 0) {
    const node = queue.shift()!;
    processed.add(node);
    for (const next of outgoing.get(node) ?? []) {
      if (!rank.has(next)) continue;
      rank.set(next, Math.max(rank.get(next) ?? 0, (rank.get(node) ?? 0) + 1));
      remaining.set(next, (remaining.get(next) ?? 1) - 1);
      if (remaining.get(next) === 0) queue.push(next);
    }
  }
  let maxRank = 0;
  for (const value of rank.values()) maxRank = Math.max(maxRank, value);
  for (const id of connected) {
    if (!processed.has(id)) rank.set(id, maxRank + 1);
  }
  maxRank = 0;
  for (const value of rank.values()) maxRank = Math.max(maxRank, value);

  const colOfMap = new Map<string, number>();
  for (const id of connected) colOfMap.set(id, Math.min(11, rank.get(id) ?? 0));
  const dump: string[] = [];
  const nested = [...isolates].sort((a, b) => a.split('/').length - b.split('/').length);
  for (const id of nested) {
    const parent = parentAmong(id, idSet);
    if (parent && colOfMap.has(parent)) {
      colOfMap.set(id, colOfMap.get(parent)!);
    } else {
      dump.push(id);
    }
  }
  if (dump.length > 0) {
    const isolateCol = Math.min(11, maxRank + 1);
    for (const id of dump) colOfMap.set(id, isolateCol);
  }

  const colOf = (id: string): number => colOfMap.get(id) ?? 0;
  const colCount = Math.max(1, ...sourceIds.map(colOf)) + 1;
  const byCol: string[][] = Array.from({ length: colCount }, () => []);
  for (const id of sourceIds) byCol[colOf(id)]?.push(id);

  for (let col = 1; col < colCount; col++) {
    byCol[col].sort((a, b) => {
      const avgPredRow = (id: string): number => {
        const preds = chords.filter((chord) => chord.target === id && colOf(chord.source) === col - 1);
        if (preds.length === 0) return index.get(id) ?? 0;
        const sum = preds.reduce((acc, chord) => acc + byCol[col - 1].indexOf(chord.source), 0);
        return sum / preds.length;
      };
      const delta = avgPredRow(a) - avgPredRow(b);
      return delta !== 0 ? delta : (index.get(a) ?? 0) - (index.get(b) ?? 0);
    });
  }

  const cells = new Map<string, GridCell>();
  byCol.forEach((ids, col) => {
    ids.forEach((id, row) => cells.set(id, { row, col }));
  });
  return cells;
}

function placeDrillFlow(hubId: string, fileIds: string[], chords: RollupChord[]): Map<string, GridCell> {
  const fileCells = placeByFlow(fileIds, chords);
  const cells = new Map<string, GridCell>();
  let maxRow = 0;
  for (const [id, cell] of fileCells) {
    cells.set(id, { row: cell.row, col: cell.col + 1 });
    maxRow = Math.max(maxRow, cell.row);
  }
  cells.set(hubId, { row: Math.floor(maxRow / 2), col: 0 });
  return cells;
}

function layoutCols(cells: Map<string, GridCell>): number {
  let maxCol = 0;
  for (const cell of cells.values()) maxCol = Math.max(maxCol, cell.col);
  return Math.min(12, Math.max(1, maxCol + 1));
}

function portForCells(from: GridCell, to: GridCell): Pick<
  ArchifyArchitectureIR['connections'][number],
  'fromSide' | 'toSide' | 'route'
> {
  if (from.col < to.col) return { fromSide: 'right', toSide: 'left', route: 'orthogonal-h' };
  if (from.col > to.col) return { fromSide: 'left', toSide: 'right', route: 'orthogonal-h' };
  if (from.row < to.row) return { fromSide: 'bottom', toSide: 'top', route: 'orthogonal-v' };
  return { fromSide: 'top', toSide: 'bottom', route: 'orthogonal-v' };
}

function connectionsFromChords(
  chords: RollupChord[],
  irIdBySource: Record<string, string>,
  cellsBySource: Map<string, GridCell>,
): ArchifyArchitectureIR['connections'] {
  const out: ArchifyArchitectureIR['connections'] = [];
  const seen = new Set<string>();
  let n = 0;
  for (const chord of chords) {
    const from = irIdBySource[chord.source];
    const to = irIdBySource[chord.target];
    if (!from || !to || from === to) continue;
    const key = from < to ? `${from}>${to}` : `${to}>${from}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const fromCell = cellsBySource.get(chord.source);
    const toCell = cellsBySource.get(chord.target);
    const ports =
      fromCell && toCell
        ? portForCells(fromCell, toCell)
        : { fromSide: 'right' as const, toSide: 'left' as const, route: 'orthogonal-h' as const };
    out.push({
      id: `link_${n++}`,
      from,
      to,
      variant: connectionVariant(chord),
      width: chordStrokeWidth(chord.weight),
      ...ports,
    });
  }
  return out;
}

function folderRegions(
  hubs: RollupHub[],
  irIdBySource: Record<string, string>,
): ArchifyArchitectureIR['boundaries'] {
  if (hubs.length < 2) return [];
  const byGroup = new Map<string, string[]>();
  for (const hub of hubs) {
    if (hub.groupKey === 'other') continue;
    const irId = irIdBySource[hub.id];
    if (!irId) continue;
    const list = byGroup.get(hub.groupKey) ?? [];
    list.push(irId);
    byGroup.set(hub.groupKey, list);
  }
  const regions: ArchifyArchitectureIR['boundaries'] = [];
  for (const [groupKey, wraps] of byGroup) {
    if (wraps.length < 2) continue;
    if (wraps.length === hubs.length) continue;
    regions.push({ kind: 'region', label: fitLabel(groupKey), wraps });
  }
  return regions;
}

function hubComponent(
  hub: RollupHub,
  irId: string,
  row: number,
  col: number,
  size: [number, number],
): ArchifyArchitectureIR['components'][number] {
  return {
    id: irId,
    type: typeForFolder(hub.folderPath || hub.groupKey),
    label: fitLabel(hub.name.replace(/\/$/, '') || hub.name),
    sublabel: `${hub.fileCount} file${hub.fileCount === 1 ? '' : 's'}`,
    ...(hub.errors > 0 ? { tag: `${hub.errors} err` } : {}),
    row,
    col,
    size,
  };
}

function fileComponent(
  file: DrillFile,
  irId: string,
  row: number,
  col: number,
): ArchifyArchitectureIR['components'][number] {
  return {
    id: irId,
    type: typeForFolder(file.groupKey),
    label: fitLabel(file.name),
    sublabel: file.id.includes('/') ? fitLabel(file.id.slice(0, file.id.lastIndexOf('/'))) : undefined,
    ...(file.errors > 0 ? { tag: `${file.errors} err` } : {}),
    row,
    col,
    size: CARD_SIZE,
  };
}

function cellOf(cells: Map<string, GridCell>, sourceId: string): GridCell {
  return cells.get(sourceId) ?? { row: 0, col: 0 };
}

export function rollupToArchifyIR(
  rollup: GraphRollup,
  options: {
    meta?: RollupPaintMeta;
    neighbourhood?: GraphOverview | null;
    drillFocus?: string | null;
    title?: string;
    reducedMotion?: boolean;
  } = {},
): ArchifyMapModel | null {
  const layout = buildRollupMapLayout(rollup, options.meta);
  const used = new Set<string>();
  const sourceByIrId: Record<string, string> = {};
  const irIdBySource: Record<string, string> = {};
  const kindByIrId: Record<string, 'folder' | 'file'> = {};

  const bind = (sourceId: string, kind: 'folder' | 'file'): string => {
    const irId = uniqueIrId(sourceId, used);
    sourceByIrId[irId] = sourceId;
    irIdBySource[sourceId] = irId;
    kindByIrId[irId] = kind;
    return irId;
  };

  const title = options.title?.trim() || 'Codebase map';
  const animation = options.reducedMotion ? 'none' : 'trace';
  const drill =
    options.neighbourhood && options.drillFocus
      ? buildDrillMapLayout(rollup, options.neighbourhood, options.drillFocus)
      : null;

  if (drill && drill.files.length > 0 && drill.hub) {
    const files = drill.files.slice(0, DRILL_FILE_CAP);
    const hubIr = bind(drill.hub.id, 'folder');
    for (const file of files) bind(file.id, 'file');
    const cells = placeDrillFlow(
      drill.hub.id,
      files.map((file) => file.id),
      drill.chords,
    );
    const hubCell = cellOf(cells, drill.hub.id);
    const components: ArchifyArchitectureIR['components'] = [
      hubComponent(drill.hub, hubIr, hubCell.row, hubCell.col, FOCUS_CARD_SIZE),
      ...files.map((file) => {
        const cell = cellOf(cells, file.id);
        return fileComponent(file, irIdBySource[file.id], cell.row, cell.col);
      }),
    ];
    const wraps = files.map((file) => irIdBySource[file.id]);
    const diagram: ArchifyArchitectureIR = {
      schema_version: 1,
      diagram_type: 'architecture',
      meta: {
        title,
        subtitle: `${files.length} file${files.length === 1 ? '' : 's'} around ${drill.hub.name} · neighbourhood`,
        visual_preset: 'signal-flow',
        quality_profile: 'showcase',
        animation,
        views: [
          {
            id: 'folder',
            label: fitLabel(drill.hub.name),
            focus: [hubIr],
            note: 'Opened folder hub from live rollup.',
          },
          ...(wraps.length > 0
            ? [{
                id: 'files',
                label: 'Neighbourhood files',
                focus: wraps,
                note: 'Files from GET /graph/neighbourhood. No invented edges.',
              }]
            : []),
        ],
      },
      layout: archifyGrid(layoutCols(cells)),
      components,
      boundaries: wraps.length > 0
        ? [{ kind: 'region', label: fitLabel(drill.hub.folderPath || drill.hub.name), wraps }]
        : [],
      connections: connectionsFromChords(drill.chords, irIdBySource, cells),
      cards: [
        {
          dot: 'cyan',
          title: 'Drill',
          items: [
            `${files.length} file card${files.length === 1 ? '' : 's'} from neighbourhood`,
            drill.files.length > files.length
              ? `${drill.files.length - files.length} more files not shown`
              : 'Server neighbourhood order preserved',
          ],
        },
        {
          dot: 'emerald',
          title: 'Routes',
          items: [
            `${drill.chords.filter((c) => irIdBySource[c.source] && irIdBySource[c.target]).length} payload links`,
            'No edges invented on the client',
          ],
        },
        {
          dot: 'rose',
          title: 'Health',
          items: [
            files.some((f) => f.errors > 0)
              ? `${files.filter((f) => f.errors > 0).length} files with errors`
              : 'No errors in shown files',
          ],
        },
      ],
    };
    return { diagram, sourceByIrId, irIdBySource, kindByIrId };
  }

  if (layout.hubs.length === 0) return null;

  for (const hub of layout.hubs) bind(hub.id, 'folder');
  const cells = placeByFlow(
    layout.hubs.map((hub) => hub.id),
    layout.chords,
  );
  const components = layout.hubs.map((hub) => {
    const cell = cellOf(cells, hub.id);
    return hubComponent(hub, irIdBySource[hub.id], cell.row, cell.col, CARD_SIZE);
  });
  const wraps = components.map((c) => c.id);
  const connections = connectionsFromChords(layout.chords, irIdBySource, cells);
  const errorHubs = layout.hubs.filter((h) => h.errors > 0).length;
  const diagram: ArchifyArchitectureIR = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: {
      title,
      subtitle: `${layout.hubs.length} folder${layout.hubs.length === 1 ? '' : 's'} from graph/rollup`,
      visual_preset: 'signal-flow',
      quality_profile: 'showcase',
      animation,
      views: [
        {
          id: 'overview',
          label: 'Folder map',
          focus: wraps,
          note: 'First paint from GET /graph/rollup. Folder cards only.',
        },
      ],
    },
    layout: archifyGrid(layoutCols(cells)),
    components,
    boundaries: folderRegions(layout.hubs, irIdBySource),
    connections,
    cards: [
      {
        dot: 'cyan',
        title: 'Rollup',
        items: [
          `${layout.hubs.length} folder cards`,
          `${connections.length} routes from rollup links`,
          layout.truncated
            ? layout.hiddenHubs > 0
              ? `${layout.hiddenHubs} more folders not shown`
              : 'Server rollup truncated'
            : 'Full returned rollup',
        ],
      },
      {
        dot: 'emerald',
        title: 'Live data',
        items: [
          'Map mount uses graph/rollup only',
          'Click a folder to load neighbourhood',
          'Archify Signal Flow geometry',
        ],
      },
      {
        dot: 'rose',
        title: 'Health',
        items: [
          errorHubs > 0 ? `${errorHubs} folders with errors` : 'No folder errors in view',
        ],
      },
    ],
  };
  return { diagram, sourceByIrId, irIdBySource, kindByIrId };
}
