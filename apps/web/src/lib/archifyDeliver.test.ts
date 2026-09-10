import { describe, expect, it } from 'vitest';
import { deliverArchitectureHtml } from './archifyDeliver';
import { rollupToArchifyIR } from './rollupToArchify';
import type { GraphOverviewNode, GraphRollup } from '../api/client';

function folder(folderPath: string, extra: Partial<GraphOverviewNode> = {}): GraphOverviewNode {
  return {
    id: `dir:${folderPath}`,
    name: `${folderPath}/`,
    kind: 'folder',
    folder: folderPath,
    folderPath,
    fileCount: 2,
    errors: 0,
    degree: 2,
    inDegree: 0,
    external: false,
    ...extra,
  };
}

const twoFolder: GraphRollup = {
  projectId: 'p-1',
  scannedAt: null,
  nodes: [folder('app'), folder('lib')],
  links: [{ source: 'dir:app', target: 'dir:lib', weight: 2, externalTarget: false }],
};

function rollup(nodes: GraphOverviewNode[], links: GraphRollup['links'] = []): GraphRollup {
  return { projectId: 'p', scannedAt: null, nodes, links };
}

describe('deliverArchitectureHtml (vendored Archify)', () => {
  it('renders rounded cards from live rollup IR', () => {
    const model = rollupToArchifyIR(twoFolder);
    expect(model).not.toBeNull();
    const { html, layoutOk } = deliverArchitectureHtml(model!.diagram);
    expect(layoutOk).toBe(true);
    expect(html).toContain('rx="6"');
    expect(html).toContain('btn-present');
    expect(html).toContain('share-card');
    expect(html).toContain('data-preset="signal-flow"');
    expect(html).toContain('folder_app');
    expect(html).toContain('folder_lib');
  });

  it('keeps Archify layoutOk on a layered eight-folder rollup', () => {
    const nodes = ['app', 'src', 'lib', 'routes', 'database', 'tests', 'config', 'resources'].map(
      (name, i) => folder(name, { fileCount: i + 2 }),
    );
    const model = rollupToArchifyIR(
      rollup(nodes, [
        { source: 'dir:app', target: 'dir:src', weight: 4, externalTarget: false },
        { source: 'dir:src', target: 'dir:lib', weight: 2, externalTarget: false },
        { source: 'dir:app', target: 'dir:routes', weight: 1, externalTarget: false },
        { source: 'dir:src', target: 'dir:database', weight: 3, externalTarget: false },
        { source: 'dir:lib', target: 'dir:tests', weight: 1, externalTarget: false },
        { source: 'dir:routes', target: 'dir:config', weight: 1, externalTarget: false },
        { source: 'dir:app', target: 'dir:resources', weight: 1, externalTarget: false },
      ]),
    );
    const { html, layoutOk } = deliverArchitectureHtml(model!.diagram);
    expect(layoutOk).toBe(true);
    expect(html).toContain('rx="6"');
    expect(html).toContain('folder_app');
  });

  it('keeps Archify layoutOk on neighbourhood drill cards', () => {
    const model = rollupToArchifyIR(twoFolder, {
      neighbourhood: {
        projectId: 'p',
        scannedAt: null,
        nodes: [
          folder('app'),
          {
            id: 'app/A.php',
            name: 'A.php',
            kind: 'file',
            folder: 'app',
            fileCount: 1,
            errors: 0,
            degree: 1,
            inDegree: 0,
            external: false,
          },
          {
            id: 'lib/C.php',
            name: 'C.php',
            kind: 'file',
            folder: 'other',
            fileCount: 1,
            errors: 0,
            degree: 1,
            inDegree: 1,
            external: false,
          },
        ],
        links: [{ source: 'app/A.php', target: 'lib/C.php', weight: 1, externalTarget: false }],
      },
      drillFocus: 'dir:app',
    });
    const { html, layoutOk } = deliverArchitectureHtml(model!.diagram);
    expect(layoutOk).toBe(true);
    expect(html).toContain('file_app_A_php');
    expect(html).toContain('file_lib_C_php');
  });
});
