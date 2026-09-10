import { describe, expect, it } from 'vitest';
import type { GraphOverviewNode, GraphRollup } from '../api/client';
import { DRILL_FILE_CAP, irIdFromSource, rollupToArchifyIR } from './rollupToArchify';

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

function rollup(nodes: GraphOverviewNode[], links: GraphRollup['links'] = []): GraphRollup {
  return { projectId: 'p', scannedAt: null, nodes, links };
}

describe('irIdFromSource', () => {
  it('turns dir: paths into Archify-safe ids', () => {
    expect(irIdFromSource('dir:app')).toBe('folder_app');
    expect(irIdFromSource('app/A.php')).toBe('file_app_A_php');
  });
});

describe('rollupToArchifyIR', () => {
  it('maps the two-folder rollup fixture to cards and the payload route only', () => {
    const model = rollupToArchifyIR(
      rollup(
        [folder('app', { fileCount: 2, degree: 2 }), folder('lib', { fileCount: 2, degree: 2, inDegree: 2 })],
        [{ source: 'dir:app', target: 'dir:lib', weight: 2, externalTarget: false }],
      ),
    );
    expect(model).not.toBeNull();
    expect(model!.diagram.diagram_type).toBe('architecture');
    expect(model!.diagram.meta.visual_preset).toBe('signal-flow');
    expect(model!.diagram.components.map((c) => c.id)).toEqual(['folder_app', 'folder_lib']);
    expect(model!.diagram.connections).toEqual([
      {
        id: 'link_0',
        from: 'folder_app',
        to: 'folder_lib',
        variant: 'default',
        width: 2,
        fromSide: 'right',
        toSide: 'left',
        route: 'orthogonal-h',
      },
    ]);
    expect(model!.diagram.components.find((c) => c.id === 'folder_app')?.col).toBe(0);
    expect(model!.diagram.components.find((c) => c.id === 'folder_lib')?.col).toBe(1);
    expect(model!.sourceByIrId.folder_app).toBe('dir:app');
    expect(model!.diagram.components.every((c) => c.size[0] > 0 && c.size[1] > 0)).toBe(true);
  });

  it('drops file-kind nodes and does not invent file edges on overview', () => {
    const model = rollupToArchifyIR(
      rollup(
        [folder('app', { fileCount: 2 }), file('app/A.php'), file('lib/C.php')],
        [
          { source: 'dir:app', target: 'app/A.php', weight: 1, externalTarget: false },
          { source: 'app/A.php', target: 'lib/C.php', weight: 1, externalTarget: false },
        ],
      ),
    );
    expect(model!.diagram.components.map((c) => c.id)).toEqual(['folder_app']);
    expect(model!.diagram.connections).toEqual([]);
    expect(Object.values(model!.kindByIrId).every((k) => k === 'folder')).toBe(true);
  });

  it('does not invent edges that are not in the rollup payload', () => {
    const model = rollupToArchifyIR(
      rollup(
        [folder('app'), folder('lib'), folder('tests')],
        [{ source: 'dir:app', target: 'dir:lib', weight: 1, externalTarget: false }],
      ),
    );
    expect(model!.diagram.connections).toHaveLength(1);
    expect(model!.diagram.connections[0]).toMatchObject({ from: 'folder_app', to: 'folder_lib' });
    expect(model!.diagram.connections.some((c) => c.from === 'folder_tests' || c.to === 'folder_tests')).toBe(false);
    const col = Object.fromEntries(model!.diagram.components.map((c) => [c.id, c.col]));
    expect(col.folder_app).toBe(0);
    expect(col.folder_lib).toBe(1);
    expect(col.folder_tests).toBe(2);
  });

  it('does not wrap every folder in one region', () => {
    const two = rollupToArchifyIR(
      rollup(
        [folder('app'), folder('lib')],
        [{ source: 'dir:app', target: 'dir:lib', weight: 1, externalTarget: false }],
      ),
    );
    expect(two!.diagram.boundaries).toEqual([]);
    expect(two!.diagram.meta.quality_profile).toBe('showcase');

    const mixed = rollupToArchifyIR(
      rollup(
        [folder('app'), folder('app/Http'), folder('lib')],
        [
          { source: 'dir:app', target: 'dir:lib', weight: 1, externalTarget: false },
          { source: 'dir:app/Http', target: 'dir:lib', weight: 1, externalTarget: false },
        ],
      ),
    );
    expect(mixed!.diagram.boundaries).toEqual([
      { kind: 'region', label: 'app', wraps: ['folder_app', 'folder_app_Http'] },
    ]);
    const wrapped = new Set(mixed!.diagram.boundaries.flatMap((b) => b.wraps));
    expect(wrapped.has('folder_lib')).toBe(false);
    expect(wrapped.size).toBeLessThan(mixed!.diagram.components.length);
  });

  it('returns null for an empty rollup (Map empty state, not a fake card)', () => {
    expect(rollupToArchifyIR(rollup([]))).toBeNull();
  });

  it('maps neighbourhood files on drill and keeps only neighbourhood links', () => {
    const model = rollupToArchifyIR(
      rollup(
        [folder('app', { fileCount: 2 }), folder('lib', { fileCount: 2 })],
        [{ source: 'dir:app', target: 'dir:lib', weight: 2, externalTarget: false }],
      ),
      {
        neighbourhood: rollup(
          [folder('app'), file('app/A.php'), file('lib/C.php')],
          [{ source: 'app/A.php', target: 'lib/C.php', weight: 1, externalTarget: false }],
        ),
        drillFocus: 'dir:app',
      },
    );
    expect(model!.diagram.components.some((c) => c.id === 'folder_app')).toBe(true);
    expect(model!.diagram.components.map((c) => model!.sourceByIrId[c.id])).toEqual([
      'dir:app',
      'app/A.php',
      'lib/C.php',
    ]);
    expect(model!.diagram.connections).toEqual([
      {
        id: 'link_0',
        from: 'file_app_A_php',
        to: 'file_lib_C_php',
        variant: 'default',
        width: 1,
        fromSide: 'right',
        toSide: 'left',
        route: 'orthogonal-h',
      },
    ]);
    expect(model!.diagram.components.find((c) => c.id === 'folder_app')?.col).toBe(0);
    expect(model!.diagram.components.find((c) => c.id === 'file_app_A_php')?.col).toBeGreaterThan(0);
    expect(model!.diagram.connections.some((c) => c.from === 'folder_app')).toBe(false);
  });

  it('caps drill files without inventing extra neighbourhood edges', () => {
    const files = Array.from({ length: DRILL_FILE_CAP + 4 }, (_, i) => file(`app/F${i}.php`));
    const model = rollupToArchifyIR(
      rollup([folder('app', { fileCount: files.length })]),
      {
        neighbourhood: rollup(files, [
          { source: 'app/F0.php', target: 'app/F1.php', weight: 1, externalTarget: false },
          { source: 'app/F20.php', target: 'app/F21.php', weight: 1, externalTarget: false },
        ]),
        drillFocus: 'dir:app',
      },
    );
    const fileCards = model!.diagram.components.filter((c) => model!.kindByIrId[c.id] === 'file');
    expect(fileCards).toHaveLength(DRILL_FILE_CAP);
    expect(model!.diagram.connections.map((c) => `${c.from}->${c.to}`)).toEqual([
      'file_app_F0_php->file_app_F1_php',
    ]);
  });

  it('is deterministic for the same rollup payload', () => {
    const payload = rollup(
      [folder('src', { fileCount: 8 }), folder('app', { fileCount: 4 })],
      [{ source: 'dir:src', target: 'dir:app', weight: 3, externalTarget: false }],
    );
    expect(rollupToArchifyIR(payload)?.diagram).toEqual(rollupToArchifyIR(payload)?.diagram);
  });

  it('layers folders left-to-right from payload edges', () => {
    const model = rollupToArchifyIR(
      rollup(
        [
          folder('app', { fileCount: 2 }),
          folder('src', { fileCount: 3 }),
          folder('lib', { fileCount: 4 }),
          folder('routes', { fileCount: 5 }),
          folder('database', { fileCount: 6 }),
          folder('tests', { fileCount: 7 }),
          folder('config', { fileCount: 8 }),
          folder('resources', { fileCount: 9 }),
        ],
        [
          { source: 'dir:app', target: 'dir:src', weight: 4, externalTarget: false },
          { source: 'dir:src', target: 'dir:lib', weight: 2, externalTarget: false },
          { source: 'dir:app', target: 'dir:routes', weight: 1, externalTarget: false },
          { source: 'dir:src', target: 'dir:database', weight: 3, externalTarget: false },
          { source: 'dir:lib', target: 'dir:tests', weight: 1, externalTarget: false },
          { source: 'dir:routes', target: 'dir:config', weight: 1, externalTarget: false },
          { source: 'dir:app', target: 'dir:resources', weight: 1, externalTarget: false },
        ],
      ),
    );
    const col = Object.fromEntries(model!.diagram.components.map((c) => [c.id, c.col]));
    expect(col.folder_app).toBe(0);
    expect(col.folder_src).toBe(1);
    expect(col.folder_routes).toBe(1);
    expect(col.folder_resources).toBe(1);
    expect(col.folder_lib).toBe(2);
    expect(col.folder_database).toBe(2);
    expect(col.folder_config).toBe(2);
    expect(col.folder_tests).toBe(3);
    for (const link of model!.diagram.connections) {
      const from = model!.diagram.components.find((c) => c.id === link.from)!;
      const to = model!.diagram.components.find((c) => c.id === link.to)!;
      expect(from.col).toBeLessThan(to.col);
    }
  });
});
