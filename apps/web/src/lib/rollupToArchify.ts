/**
 * IG-32: live GET /graph/rollup (and neighbourhood on drill) → Archify
 * architecture JSON IR. Connections are payload edges only — never invented.
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
const CARD_SIZE: [number, number] = [120, 60];
const FOCUS_CARD_SIZE: [number, number] = [140, 64];

const TYPE_BY_GROUP: Record<string, ArchifyComponentType> = {
  app: 'frontend',
  application: 'frontend',
  routes: 'frontend',
  resources: 'frontend',
  database: 'database',
  system: 'cloud',
  src: 'backend',
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

function typeForGroup(groupKey: string): ArchifyComponentType {
  return TYPE_BY_GROUP[groupKey] ?? 'backend';
}

function connectionVariant(chord: RollupChord): 'default' | 'emphasis' | 'security' {
  if (chord.broken) return 'security';
  if (chord.weight >= 5) return 'emphasis';
  return 'default';
}

function placeOnGrid(count: number, colsCap = 4): { cols: number; cells: Array<{ row: number; col: number }> } {
  const cols = Math.min(colsCap, Math.max(1, count));
  const cells = Array.from({ length: count }, (_, i) => ({
    row: Math.floor(i / cols),
    col: i % cols,
  }));
  return { cols, cells };
}

function connectionsFromChords(
  chords: RollupChord[],
  irIdBySource: Record<string, string>,
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
    out.push({
      id: `link_${n++}`,
      from,
      to,
      variant: connectionVariant(chord),
      width: chordStrokeWidth(chord.weight),
    });
  }
  return out;
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
    type: typeForGroup(hub.groupKey),
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
    type: typeForGroup(file.groupKey),
    label: fitLabel(file.name),
    sublabel: file.id.includes('/') ? fitLabel(file.id.slice(0, file.id.lastIndexOf('/'))) : undefined,
    ...(file.errors > 0 ? { tag: `${file.errors} err` } : {}),
    row,
    col,
    size: CARD_SIZE,
  };
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
    const { cols, cells } = placeOnGrid(files.length, 4);
    const components: ArchifyArchitectureIR['components'] = [
      hubComponent(drill.hub, hubIr, 0, Math.min(1, Math.max(0, cols - 1)), FOCUS_CARD_SIZE),
      ...files.map((file, i) => fileComponent(file, irIdBySource[file.id], cells[i].row + 1, cells[i].col)),
    ];
    const wraps = files.map((file) => irIdBySource[file.id]);
    const diagram: ArchifyArchitectureIR = {
      schema_version: 1,
      diagram_type: 'architecture',
      meta: {
        title,
        subtitle: `${files.length} file${files.length === 1 ? '' : 's'} around ${drill.hub.name} · neighbourhood`,
        visual_preset: 'signal-flow',
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
      layout: {
        mode: 'grid',
        origin: [48, 88],
        cols: Math.max(cols, 2),
        gapX: 48,
        gapY: 56,
        cellW: 140,
        cellH: 64,
      },
      components,
      boundaries: wraps.length > 0
        ? [{ kind: 'region', label: fitLabel(drill.hub.folderPath || drill.hub.name), wraps }]
        : [],
      connections: connectionsFromChords(drill.chords, irIdBySource),
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
  const { cols, cells } = placeOnGrid(layout.hubs.length, 4);
  const components = layout.hubs.map((hub, i) =>
    hubComponent(hub, irIdBySource[hub.id], cells[i].row, cells[i].col, CARD_SIZE),
  );
  const wraps = components.map((c) => c.id);
  const connections = connectionsFromChords(layout.chords, irIdBySource);
  const errorHubs = layout.hubs.filter((h) => h.errors > 0).length;
  const diagram: ArchifyArchitectureIR = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: {
      title,
      subtitle: `${layout.hubs.length} folder${layout.hubs.length === 1 ? '' : 's'} from graph/rollup`,
      visual_preset: 'signal-flow',
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
    layout: {
      mode: 'grid',
      origin: [48, 88],
      cols,
      gapX: 48,
      gapY: 56,
      cellW: 140,
      cellH: 64,
    },
    components,
    boundaries: [{ kind: 'region', label: 'Folders', wraps }],
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
