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
      { id: 'link_0', from: 'folder_app', to: 'folder_lib', variant: 'default', width: 2 },
    ]);
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
      { id: 'link_0', from: 'file_app_A_php', to: 'file_lib_C_php', variant: 'default', width: 1 },
    ]);
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
});
