import { describe, expect, it } from 'vitest';
import { buildGraphView, buildFileTree, defaultExpandedFolders, collapseFolder, expansionChainForFile, mergeErrorMaps } from './graphModel';
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

describe('expansionChainForFile', () => {
  it('returns every ancestor directory for a three-level path', () => {
    const chain = expansionChainForFile('application/controllers/Foo.php');
    expect([...chain].sort()).toEqual(['application', 'application/controllers']);
  });

  it('returns the single parent for a top-level file', () => {
    const chain = expansionChainForFile('app/Foo.php');
    expect([...chain]).toEqual(['app']);
  });

  it('returns an empty set for a root-level file', () => {
    const chain = expansionChainForFile('composer.json');
    expect(chain.size).toBe(0);
  });

  it('combining with buildGraphView exposes the file node', () => {
    const files = ['application/controllers/A.php'];
    const chain = expansionChainForFile('application/controllers/A.php');
    const view = buildGraphView([], files, noErrors, chain, false);
    expect(view.nodes).toHaveLength(1);
    expect(view.nodes[0].kind).toBe('file');
    expect(view.nodes[0].id).toBe('application/controllers/A.php');
  });
});

describe('mergeErrorMaps', () => {
  it('combines counts for the same path', () => {
    const base = new Map([['app/A.php', 2]]);
    const overlay = new Map([['app/A.php', 1], ['app/B.php', 3]]);
    const result = mergeErrorMaps(base, overlay);
    expect(result.get('app/A.php')).toBe(3);
    expect(result.get('app/B.php')).toBe(3);
  });

  it('does not mutate either input', () => {
    const base = new Map([['x.php', 1]]);
    const overlay = new Map([['x.php', 5]]);
    mergeErrorMaps(base, overlay);
    expect(base.get('x.php')).toBe(1);
    expect(overlay.get('x.php')).toBe(5);
  });
});

// -- buildFileTree tests ------------------------------------------------------

const noLinks = new Map<string, number>();

describe('buildFileTree -- structure', () => {
  it('emits a folder node for a directory with children', () => {
    const paths = ['app/Foo.php', 'app/Bar.php'];
    const expanded = new Set(['app']);
    const nodes = buildFileTree(paths, expanded, noLinks, noErrors);

    const kinds = nodes.map((n) => n.kind);
    expect(kinds[0]).toBe('folder');   // app/
    expect(kinds[1]).toBe('file');     // app/Foo.php
    expect(kinds[2]).toBe('file');     // app/Bar.php
  });

  it('sorts folders before files within the same parent', () => {
    const paths = ['app/z.php', 'app/sub/a.php', 'app/a.php'];
    const expanded = new Set(['app']);
    const nodes = buildFileTree(paths, expanded, noLinks, noErrors);

    // First child after 'app' folder should be the 'app/sub' folder, then files.
    const appChildren = nodes.filter((n) => n.depth === 1);
    expect(appChildren[0].kind).toBe('folder');   // app/sub
    expect(appChildren[1].kind).toBe('file');     // app/a.php
    expect(appChildren[2].kind).toBe('file');     // app/z.php
  });

  it('sorts files alphabetically within a folder', () => {
    const paths = ['lib/z.php', 'lib/a.php', 'lib/m.php'];
    const expanded = new Set(['lib']);
    const nodes = buildFileTree(paths, expanded, noLinks, noErrors);

    const files = nodes.filter((n) => n.kind === 'file').map((n) => n.name);
    expect(files).toEqual(['a.php', 'm.php', 'z.php']);
  });

  it('collapses children of unexpanded folders', () => {
    const paths = ['app/Foo.php', 'app/Bar.php'];
    const nodes = buildFileTree(paths, new Set(), noLinks, noErrors);

    // Only the folder node should be visible.
    expect(nodes).toHaveLength(1);
    expect(nodes[0].kind).toBe('folder');
    expect(nodes[0].path).toBe('app');
  });

  it('aggregates error counts into collapsed folder nodes', () => {
    const paths = ['app/Good.php', 'app/Bad.php'];
    const errors = new Map([['app/Bad.php', 3]]);
    const nodes = buildFileTree(paths, new Set(), noLinks, errors);

    expect(nodes[0].errors).toBe(3);
  });

  it('shows 0 errors on an error-free folder', () => {
    const paths = ['app/Foo.php'];
    const nodes = buildFileTree(paths, new Set(), noLinks, noErrors);
    expect(nodes[0].errors).toBe(0);
  });

  it('emits correct depth values', () => {
    const paths = ['a/b/c.php'];
    const expanded = new Set(['a', 'a/b']);
    const nodes = buildFileTree(paths, expanded, noLinks, noErrors);

    const byPath = Object.fromEntries(nodes.map((n) => [n.path, n.depth]));
    expect(byPath['a']).toBe(0);
    expect(byPath['a/b']).toBe(1);
    expect(byPath['a/b/c.php']).toBe(2);
  });

  it('handles root-level files (no folder parent)', () => {
    const paths = ['composer.json', 'README.md'];
    const nodes = buildFileTree(paths, new Set(), noLinks, noErrors);

    expect(nodes).toHaveLength(2);
    expect(nodes.every((n) => n.kind === 'file')).toBe(true);
    expect(nodes.every((n) => n.depth === 0)).toBe(true);
  });
});

describe('defaultExpandedFolders', () => {
  it('expands only top-level folders', () => {
    const paths = ['app/Foo.php', 'app/sub/Bar.php', 'lib/Baz.php'];
    const expanded = defaultExpandedFolders(paths);
    expect(expanded.has('app')).toBe(true);
    expect(expanded.has('lib')).toBe(true);
    expect(expanded.has('app/sub')).toBe(false);
  });

  it('does not add root-level files as folders', () => {
    const paths = ['README.md', 'app/Foo.php'];
    const expanded = defaultExpandedFolders(paths);
    expect(expanded.has('README.md')).toBe(false);
  });
});
