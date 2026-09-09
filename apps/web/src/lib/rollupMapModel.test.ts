import { describe, expect, it } from 'vitest';
import type { GraphOverviewNode, GraphRollup } from '../api/client';
import {
  buildDrillMapLayout,
  buildRollupMapLayout,
  chordStrokeWidth,
  FILE_DOT_RADIUS,
  isDrillFileNode,
  isRollupFolderNode,
  packHubs,
  placeOrbit,
  rankAndCapDrillFiles,
  shouldShowFileLabel,
  shouldShowHubLabel,
  LABEL_THRESHOLD,
  type DrillFile,
} from './rollupMapModel';
import { componentRadius, radialPerformanceProfile } from './radialModel';

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

function file(path: string, extra: Partial<GraphOverviewNode> = {}): GraphOverviewNode {
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
    ...extra,
  };
}

function drillFile(id: string, extra: Partial<DrillFile> = {}): DrillFile {
  return {
    id,
    name: id.split('/').pop() ?? id,
    groupKey: id.split('/')[0] ?? 'other',
    errors: 0,
    degree: 1,
    ...extra,
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
  it('sizes each ring from fileCount via componentRadius', () => {
    const { placements } = packHubs(
      [
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
      ],
      1400,
    );
    expect(placements[0].radius).toBe(componentRadius(80));
    expect(placements[1].radius).toBe(componentRadius(4));
    expect(placements[0].radius).toBeGreaterThan(placements[1].radius);
  });
});

describe('chordStrokeWidth', () => {
  it('stays between 1 and 3', () => {
    expect(chordStrokeWidth(1)).toBe(1);
    expect(chordStrokeWidth(2)).toBeGreaterThan(1);
    expect(chordStrokeWidth(10_000)).toBe(3);
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
    expect(layout.chords).toEqual([
      { source: 'app/A.php', target: 'lib/C.php', weight: 1, broken: false },
    ]);
    expect(layout.hiddenFiles).toBe(0);
    expect(layout.truncated).toBe(false);
  });

  it('does not change first-paint rollup layout (still drops files)', () => {
    const layout = buildRollupMapLayout(
      rollup([folder('app'), file('app/A.php')]),
    );
    expect(layout.hubs.map((h) => h.id)).toEqual(['dir:app']);
  });

  it('ranks then caps neighbourhood files (errors → degree → id) before paint', () => {
    const maxLeaves = radialPerformanceProfile(80).maxLeavesPerCircle;
    expect(Number.isFinite(maxLeaves)).toBe(true);

    const nodes = Array.from({ length: 80 }, (_, i) =>
      file(`app/f${String(i).padStart(2, '0')}.php`, {
        errors: i === 7 ? 4 : 0,
        degree: i === 3 ? 20 : 1,
      }),
    );
    const layout = buildDrillMapLayout(
      rollup([folder('app', { fileCount: 80 })]),
      rollup(nodes),
      'dir:app',
    );

    expect(layout.files).toHaveLength(maxLeaves);
    expect(layout.hiddenFiles).toBe(80 - maxLeaves);
    expect(layout.truncated).toBe(true);
    expect(layout.files[0].id).toBe('app/f07.php');
    expect(layout.files[1].id).toBe('app/f03.php');
  });

  it('drops chords that touch files excluded by the cap', () => {
    const maxLeaves = radialPerformanceProfile(80).maxLeavesPerCircle;
    const nodes = Array.from({ length: 80 }, (_, i) =>
      file(`app/f${String(i).padStart(2, '0')}.php`, { degree: 80 - i }),
    );
    const keptLast = `app/f${String(maxLeaves - 1).padStart(2, '0')}.php`;
    const dropped = 'app/f79.php';
    const layout = buildDrillMapLayout(
      rollup([folder('app', { fileCount: 80 })]),
      rollup(nodes, [
        { source: 'app/f00.php', target: keptLast, weight: 1, externalTarget: false },
        { source: 'app/f00.php', target: dropped, weight: 1, externalTarget: false },
      ]),
      'dir:app',
    );
    expect(layout.files.some((f) => f.id === dropped)).toBe(false);
    expect(layout.chords).toEqual([
      { source: 'app/f00.php', target: keptLast, weight: 1, broken: false },
    ]);
  });
});

describe('rankAndCapDrillFiles', () => {
  it('orders by errors, then degree, then id, and slices to max', () => {
    const { files, hiddenFiles } = rankAndCapDrillFiles(
      [
        drillFile('app/c.php', { errors: 0, degree: 9 }),
        drillFile('app/a.php', { errors: 2, degree: 1 }),
        drillFile('app/b.php', { errors: 2, degree: 5 }),
      ],
      2,
    );
    expect(files.map((f) => f.id)).toEqual(['app/b.php', 'app/a.php']);
    expect(hiddenFiles).toBe(1);
  });

  it('keeps all files when at or below the cap', () => {
    const input = [drillFile('app/z.php'), drillFile('app/a.php')];
    const { files, hiddenFiles } = rankAndCapDrillFiles(input, 10);
    expect(files.map((f) => f.id)).toEqual(['app/a.php', 'app/z.php']);
    expect(hiddenFiles).toBe(0);
  });
});

describe('shouldShowFileLabel', () => {
  it('shows every basename at or below LABEL_THRESHOLD files', () => {
    expect(shouldShowFileLabel(LABEL_THRESHOLD, 'app/a.php', null, null, 0)).toBe(true);
  });

  it('hides labels above LABEL_THRESHOLD except focus, hover, or errors', () => {
    expect(shouldShowFileLabel(LABEL_THRESHOLD + 1, 'app/a.php', null, null, 0)).toBe(false);
    expect(shouldShowFileLabel(LABEL_THRESHOLD + 1, 'app/a.php', 'app/a.php', null, 0)).toBe(true);
    expect(shouldShowFileLabel(LABEL_THRESHOLD + 1, 'app/a.php', null, 'app/a.php', 0)).toBe(true);
    expect(shouldShowFileLabel(LABEL_THRESHOLD + 1, 'app/a.php', null, null, 2)).toBe(true);
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
