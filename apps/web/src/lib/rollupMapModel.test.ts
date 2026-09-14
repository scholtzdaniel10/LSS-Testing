import { describe, expect, it } from 'vitest';
import type { GraphOverviewNode, GraphRollup } from '../api/client';
import {
  buildDrillMapLayout,
  buildRollupMapLayout,
  chordCurvePath,
  chordPaintOpacity,
  chordStrokeWidth,
  DRILL_FILE_CAP,
  FILE_DOT_RADIUS,
  hubDisplayRadius,
  hubSpineSegments,
  isDrillFileNode,
  isRollupFolderNode,
  neighbourhoodReach,
  packHubs,
  reachRoleOf,
  placeOrbit,
  presentChapters,
  presentDurations,
  rankDrillFiles,
  shortFileLabel,
  shouldShowHubLabel,
  LABEL_THRESHOLD,
} from './rollupMapModel';

function folder(
  folderPath: string,
  extra: Partial<GraphOverviewNode> = {},
): GraphOverviewNode {
  return {
    id: `dir:${folderPath}`,
    name: `${folderPath.split('/').pop()}/`,
    kind: 'folder',
    folder: folderPath.split('/')[0] ?? 'other',
    folderPath,
    fileCount: 2,
    errors: 0,
    degree: 0,
    inDegree: 0,
    external: false,
    ...extra,
  };
}

function file(path: string): GraphOverviewNode {
  return {
    id: path,
    name: path.split('/').pop() ?? path,
    kind: 'file',
    folder: path.split('/')[0] ?? 'other',
    fileCount: 1,
    errors: 0,
    degree: 1,
    inDegree: 0,
    external: false,
  };
}

function rollup(nodes: GraphOverviewNode[], links: GraphRollup['links'] = []): GraphRollup {
  return { projectId: 'p', scannedAt: null, nodes, links };
}

describe('isRollupFolderNode', () => {
  it('accepts dir: folder hubs', () => {
    expect(isRollupFolderNode(folder('app'))).toBe(true);
  });

  it('rejects file-kind nodes even with a slash path', () => {
    expect(isRollupFolderNode(file('app/A.php'))).toBe(false);
  });

  it('rejects external nodes even when id is dir-prefixed', () => {
    expect(isRollupFolderNode(folder('vendor', { kind: 'external', external: true }))).toBe(false);
    expect(isRollupFolderNode(folder('pkg', { external: true }))).toBe(false);
  });
});

describe('buildRollupMapLayout', () => {
  it('matches the two-folder rollup fixture (app → lib, weight 2)', () => {
    const layout = buildRollupMapLayout(
      rollup(
        [folder('app', { fileCount: 2, degree: 2 }), folder('lib', { fileCount: 2, degree: 2, inDegree: 2 })],
        [{ source: 'dir:app', target: 'dir:lib', weight: 2, externalTarget: false }],
      ),
    );
    expect(layout.hubs.map((h) => h.id)).toEqual(['dir:app', 'dir:lib']);
    expect(layout.chords).toEqual([
      { source: 'dir:app', target: 'dir:lib', weight: 2, broken: false },
    ]);
    expect(layout.hubs.some((h) => h.id.includes('.php'))).toBe(false);
  });

  it('drops file-kind nodes and chords that touch them (never paint overview file-dots)', () => {
    const layout = buildRollupMapLayout(
      rollup(
        [folder('app', { fileCount: 2 }), file('app/A.php'), file('lib/C.php')],
        [
          { source: 'dir:app', target: 'app/A.php', weight: 1, externalTarget: false },
          { source: 'app/A.php', target: 'lib/C.php', weight: 1, externalTarget: false },
        ],
      ),
    );
    expect(layout.hubs.map((h) => h.id)).toEqual(['dir:app']);
    expect(layout.chords).toEqual([]);
  });

  it('drops external nodes and chords that touch them', () => {
    const layout = buildRollupMapLayout(
      rollup(
        [
          folder('app', { fileCount: 2 }),
          folder('vendor', { kind: 'external', external: true, fileCount: 9 }),
        ],
        [{ source: 'dir:app', target: 'dir:vendor', weight: 4, externalTarget: true }],
      ),
    );
    expect(layout.hubs.map((h) => h.id)).toEqual(['dir:app']);
    expect(layout.chords).toEqual([]);
  });

  it('preserves server ranking order (does not re-sort by id)', () => {
    const layout = buildRollupMapLayout(
      rollup([
        folder('src', { fileCount: 80 }),
        folder('app', { fileCount: 40 }),
        folder('lib', { fileCount: 10 }),
      ]),
    );
    expect(layout.hubs.map((h) => h.folderPath)).toEqual(['src', 'app', 'lib']);
  });

  it('slices by radialPerformanceProfile maxCircles without re-sorting', () => {
    // 8 folders × 30 files = 240 → huge profile, maxCircles = 5.
    const nodes = Array.from({ length: 8 }, (_, i) =>
      folder(`f${i}`, { fileCount: 30 }),
    );
    const layout = buildRollupMapLayout(rollup(nodes));
    expect(layout.hubs.map((h) => h.folderPath)).toEqual(['f0', 'f1', 'f2', 'f3', 'f4']);
    expect(layout.hiddenHubs).toBe(3);
    expect(layout.truncated).toBe(true);
  });

  it('marks a chord broken when either hub has errors', () => {
    const layout = buildRollupMapLayout(
      rollup(
        [folder('app', { errors: 3 }), folder('lib')],
        [{ source: 'dir:app', target: 'dir:lib', weight: 1, externalTarget: false }],
      ),
    );
    expect(layout.chords[0].broken).toBe(true);
  });

  it('returns no hubs for an empty rollup', () => {
    const layout = buildRollupMapLayout(rollup([]));
    expect(layout.hubs).toEqual([]);
    expect(layout.chords).toEqual([]);
    expect(layout.truncated).toBe(false);
  });

  it('flags truncated from meta even when every returned hub is shown', () => {
    const layout = buildRollupMapLayout(rollup([folder('app')]), { truncated: true, cap: 1 });
    expect(layout.truncated).toBe(true);
  });
});

describe('packHubs', () => {
  const twoHubs = [
    {
      id: 'dir:app',
      name: 'app/',
      folderPath: 'app',
      groupKey: 'app',
      fileCount: 80,
      errors: 0,
      degree: 0,
    },
    {
      id: 'dir:lib',
      name: 'lib/',
      folderPath: 'lib',
      groupKey: 'other',
      fileCount: 4,
      errors: 0,
      degree: 0,
    },
  ];

  it('sizes hubs by relative fileCount (largest reads as the primary)', () => {
    const { placements } = packHubs(twoHubs, 1400);
    expect(placements[0].radius).toBe(hubDisplayRadius(80, 80));
    expect(placements[1].radius).toBe(hubDisplayRadius(4, 80));
    expect(placements[0].radius).toBeGreaterThan(placements[1].radius);
  });

  it('keeps a gap between hubs so the spine is not a packed bubble chart', () => {
    const { placements } = packHubs(twoHubs, 1400);
    const dist = Math.hypot(placements[0].cx - placements[1].cx, placements[0].cy - placements[1].cy);
    expect(dist).toBeGreaterThan(placements[0].radius + placements[1].radius + 24);
    expect(placements[0].labelY).toBeGreaterThan(placements[0].cy);
    expect(placements[0].cy).toBe(placements[1].cy);
  });
});

describe('hubDisplayRadius', () => {
  it('ranks a larger folder above a smaller one', () => {
    expect(hubDisplayRadius(80, 80)).toBeGreaterThan(hubDisplayRadius(4, 80));
  });
});

describe('hubSpineSegments', () => {
  it('draws one hairline through a single packed row', () => {
    const { placements } = packHubs(
      [
        { id: 'dir:app', name: 'app/', folderPath: 'app', groupKey: 'app', fileCount: 8, errors: 0, degree: 0 },
        { id: 'dir:lib', name: 'lib/', folderPath: 'lib', groupKey: 'other', fileCount: 4, errors: 0, degree: 0 },
      ],
      1400,
    );
    const spines = hubSpineSegments(placements);
    expect(spines).toHaveLength(1);
    expect(spines[0].x2).toBeGreaterThan(spines[0].x1);
  });
});

describe('chordStrokeWidth', () => {
  it('stays between 1 and 3', () => {
    expect(chordStrokeWidth(1)).toBeGreaterThanOrEqual(1);
    expect(chordStrokeWidth(2)).toBeGreaterThan(chordStrokeWidth(1));
    expect(chordStrokeWidth(10_000)).toBeLessThanOrEqual(3);
  });
});

describe('chordCurvePath', () => {
  it('emits a quadratic path between two hubs', () => {
    const d = chordCurvePath(0, 0, 100, 0);
    expect(d.startsWith('M 0 0 Q ')).toBe(true);
    expect(d.endsWith(' 100 0')).toBe(true);
  });
});

describe('chordPaintOpacity', () => {
  it('whispers until focus, then lights only the route', () => {
    expect(chordPaintOpacity(false, false)).toBeLessThan(0.1);
    expect(chordPaintOpacity(true, true)).toBeGreaterThan(0.8);
    expect(chordPaintOpacity(true, false)).toBeLessThan(0.1);
  });
});

describe('neighbourhoodReach', () => {
  it('includes the focus and one-hop neighbours from payload chords only', () => {
    const reach = neighbourhoodReach(
      [
        { source: 'dir:app', target: 'dir:lib', weight: 2, broken: false },
        { source: 'dir:lib', target: 'dir:src', weight: 1, broken: false },
      ],
      'dir:app',
    );
    expect([...reach].sort()).toEqual(['dir:app', 'dir:lib']);
    expect(reach.has('dir:src')).toBe(false);
  });

  it('is empty without a focus', () => {
    expect(neighbourhoodReach([{ source: 'a', target: 'b', weight: 1, broken: false }], null).size).toBe(0);
  });
});

describe('reachRoleOf', () => {
  const chords = [
    { source: 'dir:app', target: 'dir:lib', weight: 2, broken: false },
    { source: 'dir:src', target: 'dir:app', weight: 1, broken: false },
  ];

  it('marks origin, upstream, and downstream from payload chords only', () => {
    expect(reachRoleOf('dir:app', 'dir:app', chords)).toBe('origin');
    expect(reachRoleOf('dir:lib', 'dir:app', chords)).toBe('downstream');
    expect(reachRoleOf('dir:src', 'dir:app', chords)).toBe('upstream');
    expect(reachRoleOf('dir:other', 'dir:app', chords)).toBe('none');
  });
});

describe('shouldShowHubLabel', () => {
  it('shows every label at or below LABEL_THRESHOLD hubs', () => {
    expect(shouldShowHubLabel(LABEL_THRESHOLD, 'dir:app', null, null)).toBe(true);
  });

  it('hides labels above LABEL_THRESHOLD except focus/hover', () => {
    expect(shouldShowHubLabel(LABEL_THRESHOLD + 1, 'dir:app', null, null)).toBe(false);
    expect(shouldShowHubLabel(LABEL_THRESHOLD + 1, 'dir:app', 'dir:app', null)).toBe(true);
    expect(shouldShowHubLabel(LABEL_THRESHOLD + 1, 'dir:app', null, 'dir:app')).toBe(true);
  });
});

describe('isDrillFileNode', () => {
  it('accepts internal file nodes', () => {
    expect(isDrillFileNode(file('app/A.php'))).toBe(true);
  });

  it('rejects folder and external nodes', () => {
    expect(isDrillFileNode(folder('app'))).toBe(false);
    expect(isDrillFileNode({ ...file('app/A.php'), kind: 'external', external: true })).toBe(false);
  });
});

describe('buildDrillMapLayout', () => {
  it('keeps the clicked hub and file nodes from neighbourhood, dropping extra folders', () => {
    const layout = buildDrillMapLayout(
      rollup([folder('app', { fileCount: 2 }), folder('lib', { fileCount: 2 })]),
      rollup(
        [folder('app'), file('app/A.php'), file('lib/C.php')],
        [{ source: 'app/A.php', target: 'lib/C.php', weight: 1, externalTarget: false }],
      ),
      'dir:app',
    );
    expect(layout.hub?.id).toBe('dir:app');
    expect(layout.files.map((f) => f.id)).toEqual(['app/A.php', 'lib/C.php']);
    expect(layout.hiddenFiles).toBe(0);
    expect(layout.chords).toEqual([
      { source: 'app/A.php', target: 'lib/C.php', weight: 1, broken: false },
    ]);
  });

  it('caps and ranks files so the drill is not a starfield', () => {
    const files = Array.from({ length: DRILL_FILE_CAP + 5 }, (_, i) =>
      file(`app/F${String(i).padStart(2, '0')}.php`),
    );
    files[3] = { ...files[3], errors: 4, degree: 1 };
    files[7] = { ...files[7], errors: 0, degree: 9 };
    const layout = buildDrillMapLayout(
      rollup([folder('app')]),
      rollup(files),
      'dir:app',
    );
    expect(layout.files).toHaveLength(DRILL_FILE_CAP);
    expect(layout.hiddenFiles).toBe(5);
    expect(layout.files[0].id).toBe('app/F03.php');
    expect(layout.files[1].id).toBe('app/F07.php');
  });

  it('does not change first-paint rollup layout (still drops files)', () => {
    const layout = buildRollupMapLayout(
      rollup([folder('app'), file('app/A.php')]),
    );
    expect(layout.hubs.map((h) => h.id)).toEqual(['dir:app']);
  });
});

describe('placeOrbit', () => {
  it('places count dots on a ring outside the hub radius', () => {
    const pts = placeOrbit(100, 100, 40, 4);
    expect(pts).toHaveLength(4);
    const dist = (p: { cx: number; cy: number }) =>
      Math.hypot(p.cx - 100, p.cy - 100);
    expect(dist(pts[0])).toBeGreaterThan(40 + FILE_DOT_RADIUS);
    expect(pts[0].cy).toBeLessThan(100);
  });

  it('returns empty for zero files', () => {
    expect(placeOrbit(0, 0, 10, 0)).toEqual([]);
  });
});

describe('rankDrillFiles', () => {
  it('orders by errors, then degree, then id', () => {
    const { visible, hidden } = rankDrillFiles([
      { id: 'b.php', name: 'b.php', groupKey: 'app', errors: 0, degree: 2 },
      { id: 'a.php', name: 'a.php', groupKey: 'app', errors: 3, degree: 1 },
      { id: 'c.php', name: 'c.php', groupKey: 'app', errors: 0, degree: 9 },
    ]);
    expect(visible.map((f) => f.id)).toEqual(['a.php', 'c.php', 'b.php']);
    expect(hidden).toBe(0);
  });
});

describe('shortFileLabel', () => {
  it('keeps short names and trims long ones', () => {
    expect(shortFileLabel('A.php')).toBe('A.php');
    expect(shortFileLabel('VeryLongControllerName.php', 10)).toBe('VeryLongC…');
  });
});

describe('presentChapters', () => {
  it('is overview plus one drill on the first ranked hub', () => {
    const chapters = presentChapters([
      { id: 'dir:app', name: 'app/', folderPath: 'app', groupKey: 'app', fileCount: 8, errors: 0, degree: 0 },
      { id: 'dir:lib', name: 'lib/', folderPath: 'lib', groupKey: 'other', fileCount: 2, errors: 0, degree: 0 },
    ]);
    expect(chapters).toEqual([
      { id: 'overview', title: 'Folders', hubId: null },
      { id: 'drill', title: 'app/', hubId: 'dir:app' },
    ]);
  });

  it('stays overview-only when there are no hubs', () => {
    expect(presentChapters([])).toEqual([{ id: 'overview', title: 'Folders', hubId: null }]);
  });
});

describe('presentDurations', () => {
  it('collapses motion when the user prefers reduced motion', () => {
    expect(presentDurations(true)).toEqual({ overviewMs: 0, reachMs: 0 });
    expect(presentDurations(false).overviewMs).toBeGreaterThan(0);
  });
});
