import { describe, expect, it } from 'vitest';
import type { GraphOverviewNode, GraphRollup } from '../api/client';
import {
  buildRollupMapLayout,
  chordStrokeWidth,
  isRollupFolderNode,
  packHubs,
  shouldShowHubLabel,
  LABEL_THRESHOLD,
} from './rollupMapModel';
import { componentRadius } from './radialModel';

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
