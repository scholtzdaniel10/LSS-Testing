import { describe, expect, it } from 'vitest';
import { deliverArchitectureHtml } from './archifyDeliver';
import { rollupToArchifyIR } from './rollupToArchify';
import type { GraphOverviewNode, GraphRollup } from '../api/client';

function folder(folderPath: string): GraphOverviewNode {
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
  };
}

const twoFolder: GraphRollup = {
  projectId: 'p-1',
  scannedAt: null,
  nodes: [folder('app'), folder('lib')],
  links: [{ source: 'dir:app', target: 'dir:lib', weight: 2, externalTarget: false }],
};

describe('deliverArchitectureHtml (vendored Archify)', () => {
  it('renders rounded cards from live rollup IR', () => {
    const model = rollupToArchifyIR(twoFolder);
    expect(model).not.toBeNull();
    const { html } = deliverArchitectureHtml(model!.diagram);
    expect(html).toContain('rx="6"');
    expect(html).toContain('btn-present');
    expect(html).toContain('share-card');
    expect(html).toContain('data-preset="signal-flow"');
    expect(html).toContain('folder_app');
    expect(html).toContain('folder_lib');
  });
});
