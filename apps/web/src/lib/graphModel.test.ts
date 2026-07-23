import { describe, expect, it } from 'vitest';
import { buildGraphView, buildFileTree, defaultExpandedFolders, collapseFolder, expansionChainForFile, mergeErrorMaps, buildStackProfile, folderColor, parseExternalRef, buildNeighbourMap, neighbourhoodWithin, cappedNeighbourhood, filterForceGraphData, searchGraphNodes, resolveGraphColor, graphPerformanceProfile, clusterCenters, applyClusterLayout, isCrossClusterLink, clusterKey, hugeGraphOverviewKeep } from './graphModel';
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


// ── IG-22: StackProfile + folderColor tests ──────────────────────────────────

describe('buildStackProfile', () => {
  it('returns token var for known folder keys', () => {
    const profile = buildStackProfile([]);
    expect(folderColor('app', profile)).toBe('var(--series-1)');
    expect(folderColor('routes', profile)).toBe('var(--series-2)');
    expect(folderColor('unknown', profile)).toBe('var(--series-other)');
  });

  it('CI3 profile maps application to series-1, system to series-2', () => {
    const profile = buildStackProfile(['codeigniter-3']);
    expect(folderColor('application', profile)).toBe('var(--series-1)');
    expect(folderColor('system', profile)).toBe('var(--series-2)');
  });

  it('React profile maps src and components', () => {
    const profile = buildStackProfile(['react']);
    expect(folderColor('src', profile)).toBe('var(--series-1)');
    expect(folderColor('components', profile)).toBe('var(--series-3)');
  });

  it('buildGraphView accepts a StackProfile and uses its colors', () => {
    const files = ['application/controllers/A.php'];
    const profile = buildStackProfile(['codeigniter-3']);
    const view = buildGraphView([], files, new Map(), new Set(), false, profile);
    // The "application" folder node should use CI3 series-1
    const folderNode = view.nodes.find((n) => n.kind === 'folder');
    expect(folderNode?.color).toBe('var(--series-1)');
  });
});

describe('parseExternalRef (IG-22)', () => {
  it('parses php: prefix', () => {
    const r = parseExternalRef('php:App\\Models\\User');
    expect(r.external).toBe(true);
    if (r.external) expect(r.label).toBe('User');
  });

  it('parses pkg: prefix', () => {
    const r = parseExternalRef('pkg:guzzlehttp/guzzle');
    expect(r.external).toBe(true);
    if (r.external) expect(r.label).toBe('guzzlehttp/guzzle');
  });

  it('returns non-external for plain file paths', () => {
    const r = parseExternalRef('src/utils.ts');
    expect(r.external).toBe(false);
  });
});

describe('neighbourhoodWithin (IG-13)', () => {
  const links = [
    { source: 'a', target: 'b', weight: 1, externalTarget: false },
    { source: 'b', target: 'c', weight: 1, externalTarget: false },
    { source: 'c', target: 'd', weight: 1, externalTarget: false },
  ];
  const map = buildNeighbourMap(links);

  it('includes only direct neighbours at depth 1', () => {
    const set = neighbourhoodWithin('b', map, 1);
    expect([...set].sort()).toEqual(['a', 'b', 'c']);
  });

  it('extends to two hops at depth 2', () => {
    const set = neighbourhoodWithin('b', map, 2);
    expect([...set].sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('clamps depth to a maximum of 3', () => {
    const set = neighbourhoodWithin('a', map, 99);
    expect(set.has('d')).toBe(true);
  });
});

describe('searchGraphNodes (IG-13)', () => {
  const nodes = buildGraphView(
    [],
    ['application/controllers/Home.php', 'application/models/User.php', 'system/core/Common.php'],
    noErrors,
    new Set(['application', 'application/controllers', 'application/models']),
    false,
    buildStackProfile(['codeigniter-3']),
  ).nodes;

  it('finds files by partial path', () => {
    const hits = searchGraphNodes(nodes, 'user');
    expect(hits.some((n) => n.id.endsWith('User.php'))).toBe(true);
  });

  it('returns empty for blank query', () => {
    expect(searchGraphNodes(nodes, '   ')).toEqual([]);
  });
});

describe('resolveGraphColor', () => {
  it('resolves var() tokens via the reader', () => {
    expect(resolveGraphColor('var(--series-1)', () => '#4584d3')).toBe('#4584d3');
    expect(resolveGraphColor('#ff00ff', () => '')).toBe('#ff00ff');
  });
});

describe('graphPerformanceProfile (IG-13 perf)', () => {
  it('keeps full quality for small graphs', () => {
    const p = graphPerformanceProfile(40);
    expect(p.tier).toBe('small');
    expect(p.sparseLabels).toBe(false);
    expect(p.fixedLayout).toBe(false);
    expect(p.enableNodeDrag).toBe(true);
    expect(p.maxCanvasDpr).toBe(1);
    expect(p.showLinkArrows).toBe(true);
  });

  it('uses fixed layout and skips simulation for huge graphs', () => {
    const p = graphPerformanceProfile(400);
    expect(p.tier).toBe('huge');
    expect(p.maxCanvasDpr).toBe(1);
    expect(p.sparseLabels).toBe(true);
    expect(p.fixedLayout).toBe(true);
    expect(p.simpleLabelPaint).toBe(true);
    expect(p.enableNodeDrag).toBe(false);
    expect(p.showLinkArrows).toBe(false);
    expect(p.hoverRedraw).toBe(false);
    expect(p.warmupTicks).toBe(0);
    expect(p.cooldownTicks).toBe(0);
    expect(p.maxFocusNodes).toBeLessThan(80);
  });
});

describe('cappedNeighbourhood (IG-14 perf)', () => {
  it('limits neighbourhood size while keeping the root', () => {
    const neighbours = new Map<string, Set<string>>();
    for (let i = 1; i <= 20; i++) {
      neighbours.set('root', new Set([...(neighbours.get('root') ?? []), `n${i}`]));
      neighbours.set(`n${i}`, new Set(['root']));
    }
    const capped = cappedNeighbourhood('root', neighbours, 1, 6);
    expect(capped.has('root')).toBe(true);
    expect(capped.size).toBe(6);
  });
});

describe('filterForceGraphData (IG-14 perf)', () => {
  it('drops nodes and links outside the keep set', () => {
    const nodes = [
      { id: 'a', name: 'a', kind: 'file' as const, folder: 'app', external: false, errors: 0, inDegree: 0, degree: 1, fileCount: 1, color: '' },
      { id: 'b', name: 'b', kind: 'file' as const, folder: 'app', external: false, errors: 0, inDegree: 0, degree: 0, fileCount: 1, color: '' },
    ];
    const links = [{ source: 'a', target: 'b', weight: 1, externalTarget: false }];
    const filtered = filterForceGraphData(nodes, links, new Set(['a']));
    expect(filtered.nodes).toHaveLength(1);
    expect(filtered.links).toHaveLength(0);
  });
});

describe('hugeGraphOverviewKeep (IG-14 perf)', () => {
  it('keeps error files and top-degree files when capping overview', () => {
    const files = Array.from({ length: 100 }, (_, i) => `src/f${i}.ts`);
    const view = buildGraphView([], files, new Map([['src/f0.ts', 1]]), new Set(['src']), false);
    const keep = hugeGraphOverviewKeep(view.nodes, 20);
    expect(keep.has('src/f0.ts')).toBe(true);
    expect(keep.size).toBe(21);
  });
});

describe('cluster layout (IG-14)', () => {
  it('places application and system in separate cluster lanes', () => {
    const files = [
      'application/controllers/Home.php',
      'application/models/User.php',
      'system/core/Common.php',
    ];
    const view = buildGraphView([], files, noErrors, new Set(), false, buildStackProfile(['codeigniter-3']));
    const centers = clusterCenters(view.nodes);
    expect(centers.has('application')).toBe(true);
    expect(centers.has('system')).toBe(true);
    const app = centers.get('application')!;
    const sys = centers.get('system')!;
    expect(Math.hypot(app.x - sys.x, app.y - sys.y)).toBeGreaterThan(100);
  });

  it('pins folder hubs and seeds file nodes near their cluster', () => {
    const files = ['app/A.php', 'app/B.php', 'lib/C.php'];
    const view = buildGraphView([], files, noErrors, new Set(), false);
    const nodes = view.nodes.map((n) => ({ ...n }));
    const centers = clusterCenters(nodes);
    applyClusterLayout(nodes, centers);
    const appFolder = nodes.find((n) => n.folderPath === 'app');
    const libFolder = nodes.find((n) => n.folderPath === 'lib');
    expect(appFolder?.kind).toBe('folder');
    expect(libFolder?.kind).toBe('folder');
    expect(appFolder?.fx).toBe(centers.get('app')?.x);
    expect(libFolder?.fx).toBe(centers.get('lib')?.x);
    expect(clusterKey(appFolder!)).toBe('app');
  });

  it('detects cross-cluster links between top-level modules', () => {
    const files = ['app/A.php', 'lib/B.php'];
    const edges = [edge('app/A.php', 'lib/B.php')];
    const view = buildGraphView(edges, files, noErrors, new Set(['app', 'lib']), false);
    const nodeById = new Map(view.nodes.map((n) => [n.id, n]));
    expect(view.links).toHaveLength(1);
    expect(isCrossClusterLink(view.links[0], nodeById)).toBe(true);
  });
});
