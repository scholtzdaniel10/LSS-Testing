import { describe, expect, it } from 'vitest';
import { buildGraphView, collapseFolder } from './graphModel';
import type { GraphEdge } from '../api/client';

const edge = (from: string, to: string): GraphEdge => ({ from, to, kind: 'import' });
const noErrors = new Map<string, number>();

describe('buildGraphView — folder aggregation', () => {
  it('collapses files into one folder node by default', () => {
    const files = ['application/controllers/A.php', 'application/controllers/B.php', 'application/models/M.php'];
    const view = buildGraphView([], files, noErrors, new Set(), false);

    expect(view.nodes).toHaveLength(1);
    expect(view.nodes[0].kind).toBe('folder');
    expect(view.nodes[0].folderPath).toBe('application');
    expect(view.nodes[0].fileCount).toBe(3);
    expect(view.folderCount).toBe(1);
  });

  it('drills into a folder when it is expanded', () => {
    const files = ['application/controllers/A.php', 'application/models/M.php'];
    const view = buildGraphView([], files, noErrors, new Set(['application']), false);

    const ids = view.nodes.map((n) => n.folderPath ?? n.id).sort();
    expect(ids).toEqual(['application/controllers', 'application/models']);
    expect(view.nodes.every((n) => n.kind === 'folder')).toBe(true);
  });

  it('reaches the file itself once its whole folder chain is expanded', () => {
    const files = ['application/controllers/A.php'];
    const view = buildGraphView([], files, noErrors, new Set(['application', 'application/controllers']), false);

    expect(view.nodes).toHaveLength(1);
    expect(view.nodes[0].kind).toBe('file');
    expect(view.nodes[0].id).toBe('application/controllers/A.php');
  });

  it('hides external packages by default and counts the hidden edges', () => {
    const files = ['app/A.php'];
    const edges = [edge('app/A.php', 'pkg:guzzlehttp/guzzle'), edge('app/A.php', 'php:App\\Models\\Invoice')];

    const hidden = buildGraphView(edges, files, noErrors, new Set(), false);
    expect(hidden.nodes.some((n) => n.external)).toBe(false);
    expect(hidden.hiddenExternal).toBe(2);

    const shown = buildGraphView(edges, files, noErrors, new Set(), true);
    expect(shown.nodes.filter((n) => n.external)).toHaveLength(2);
  });

  it('aggregates edges between folders and weights them by count', () => {
    const files = ['app/A.php', 'app/B.php', 'lib/C.php', 'lib/D.php'];
    const edges = [edge('app/A.php', 'lib/C.php'), edge('app/B.php', 'lib/D.php')];
    const view = buildGraphView(edges, files, noErrors, new Set(), false);

    expect(view.folderCount).toBe(2);
    expect(view.links).toHaveLength(1);
    expect(view.links[0].weight).toBe(2);
  });
});

describe('collapseFolder', () => {
  it('also collapses folders expanded beneath the collapsed one', () => {
    const expanded = new Set(['application', 'application/controllers', 'system']);
    const next = collapseFolder(expanded, 'application');
    expect([...next]).toEqual(['system']);
  });
});
