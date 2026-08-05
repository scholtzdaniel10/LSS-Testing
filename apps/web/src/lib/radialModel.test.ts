import { describe, expect, it } from 'vitest';
import {
  buildRadialLayout,
  buildHierarchy,
  classifyEdges,
  computeFocusNeighbourhood,
  collectLeaves,
  componentRadius,
  shouldShowLabel,
  folderKeyOf,
  buildFolderLayout,
  buildDrillComponent,
  layoutLeavesHierarchical,
  countLeaves,
  MIN_ARC_PX,
  MIN_RADIUS_PX,
  MAX_RADIUS_PX,
  LABEL_THRESHOLD,
  radialPerformanceProfile,
  capRadialComponentFiles,
  capRadialEdges,
  applyRadialRenderCap,
} from './radialModel';
import type { GraphEdge } from '../api/client';

// -- helpers ------------------------------------------------------------------
const edge = (from: string, to: string): GraphEdge => ({ from, to });
const noErrors = new Set<string>();

// -- buildHierarchy -----------------------------------------------------------
describe('buildHierarchy', () => {
  it('produces a root with file children for flat paths', () => {
    const root = buildHierarchy(['a.ts', 'b.ts']);
    expect(root.id).toBe('');
    const leaves = collectLeaves(root);
    expect(leaves.map((l) => l.id).sort()).toEqual(['a.ts', 'b.ts']);
  });

  it('nests files under dir nodes for slash paths', () => {
    const root = buildHierarchy(['src/a.ts', 'src/b.ts', 'lib/c.ts']);
    expect(root.children.map((c) => c.id).sort()).toEqual(['lib', 'src']);
    const src = root.children.find((c) => c.id === 'src')!;
    expect(src.children).toHaveLength(2);
  });

  it('returns all leaves for deep paths', () => {
    const files = ['a/b/c/D.php', 'a/b/c/E.php', 'a/f/G.php'];
    const root = buildHierarchy(files);
    const leaves = collectLeaves(root);
    expect(leaves.map((l) => l.id).sort()).toEqual(files.sort());
  });

  it('handles a single file', () => {
    const root = buildHierarchy(['solo.ts']);
    expect(collectLeaves(root)).toHaveLength(1);
    expect(collectLeaves(root)[0].id).toBe('solo.ts');
  });
});

// -- classifyEdges ------------------------------------------------------------
describe('classifyEdges', () => {
  it('marks edges grey when no endpoint has errors', () => {
    const edges = [edge('a.ts', 'b.ts'), edge('b.ts', 'c.ts')];
    const result = classifyEdges(edges, noErrors);
    expect(result.every((e) => !e.broken)).toBe(true);
  });

  it('marks an edge red when the "from" endpoint has errors', () => {
    const errors = new Set(['a.ts']);
    const result = classifyEdges([edge('a.ts', 'b.ts')], errors);
    expect(result[0].broken).toBe(true);
  });

  it('marks an edge red when the "to" endpoint has errors', () => {
    const errors = new Set(['b.ts']);
    const result = classifyEdges([edge('a.ts', 'b.ts')], errors);
    expect(result[0].broken).toBe(true);
  });

  it('does NOT mark edges red for warning-only files (errors set is empty)', () => {
    const result = classifyEdges([edge('a.ts', 'b.ts')], noErrors);
    expect(result[0].broken).toBe(false);
  });

  it('handles empty edge list', () => {
    expect(classifyEdges([], noErrors)).toEqual([]);
  });
});

// -- computeFocusNeighbourhood ------------------------------------------------
describe('computeFocusNeighbourhood', () => {
  const edges = classifyEdges(
    [edge('a.ts', 'b.ts'), edge('b.ts', 'c.ts'), edge('d.ts', 'b.ts')],
    noErrors,
  );

  it('collects both incoming and outgoing neighbours', () => {
    const nb = computeFocusNeighbourhood('b.ts', edges);
    expect([...nb.neighbours].sort()).toEqual(['a.ts', 'c.ts', 'd.ts']);
  });

  it('returns only edges that touch the focus', () => {
    const nb = computeFocusNeighbourhood('b.ts', edges);
    expect(nb.edges).toHaveLength(3);
  });

  it('focus with no edges returns empty neighbours', () => {
    const nb = computeFocusNeighbourhood('x.ts', edges);
    expect(nb.neighbours.size).toBe(0);
    expect(nb.edges).toHaveLength(0);
  });

  it('only out-edges when file is a pure source', () => {
    const nb = computeFocusNeighbourhood('a.ts', edges);
    expect([...nb.neighbours]).toEqual(['b.ts']);
  });

  it('only in-edges when file is a pure sink', () => {
    const nb = computeFocusNeighbourhood('c.ts', edges);
    expect([...nb.neighbours]).toEqual(['b.ts']);
  });
});

// -- buildRadialLayout -- empty / null cases -----------------------------------
describe('buildRadialLayout -- empty / null cases', () => {
  it('returns empty layout for empty file list', () => {
    const layout = buildRadialLayout([], [], noErrors);
    expect(layout.components).toHaveLength(0);
    expect(layout.unlinked.files).toHaveLength(0);
  });

  it('returns all files as unlinked when edges array is empty', () => {
    const files = ['a.ts', 'b.ts', 'c.ts'];
    const layout = buildRadialLayout(files, [], noErrors);
    expect(layout.components).toHaveLength(0);
    expect(layout.unlinked.files.sort()).toEqual(files.sort());
  });
});

describe('buildRadialLayout -- connected components', () => {
  it('splits two disjoint pairs into two components', () => {
    const files = ['a.ts', 'b.ts', 'c.ts', 'd.ts'];
    const edges = [edge('a.ts', 'b.ts'), edge('c.ts', 'd.ts')];
    const layout = buildRadialLayout(files, edges, noErrors);
    expect(layout.components).toHaveLength(2);
    expect(layout.unlinked.files).toHaveLength(0);
  });

  it('orders components largest first', () => {
    const files = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'];
    const edges = [
      edge('a.ts', 'b.ts'),
      edge('b.ts', 'c.ts'),
      edge('d.ts', 'e.ts'),
    ];
    const layout = buildRadialLayout(files, edges, noErrors);
    expect(layout.components[0].files.length).toBeGreaterThanOrEqual(
      layout.components[1].files.length,
    );
  });

  it('places files with no edges in unlinked, not in a component', () => {
    const files = ['a.ts', 'b.ts', 'lone.ts'];
    const edges = [edge('a.ts', 'b.ts')];
    const layout = buildRadialLayout(files, edges, noErrors);
    expect(layout.components).toHaveLength(1);
    expect(layout.unlinked.files).toEqual(['lone.ts']);
  });

  it('unlinked group is sorted', () => {
    const files = ['z.ts', 'm.ts', 'a.ts'];
    const layout = buildRadialLayout(files, [], noErrors);
    expect(layout.unlinked.files).toEqual(['a.ts', 'm.ts', 'z.ts']);
  });

  it('strips external pkg: and php: edges from components', () => {
    const files = ['a.ts', 'b.ts'];
    const edges = [
      edge('a.ts', 'pkg:lodash'),
      edge('b.ts', 'php:App\\Foo'),
      edge('a.ts', 'b.ts'),
    ];
    const layout = buildRadialLayout(files, edges, noErrors);
    expect(layout.components).toHaveLength(1);
    expect(layout.components[0].files.sort()).toEqual(['a.ts', 'b.ts']);
  });

  it('single large component merges transitively connected files', () => {
    const files = ['a.ts', 'b.ts', 'c.ts', 'd.ts'];
    const edges = [edge('a.ts', 'b.ts'), edge('b.ts', 'c.ts'), edge('c.ts', 'd.ts')];
    const layout = buildRadialLayout(files, edges, noErrors);
    expect(layout.components).toHaveLength(1);
    expect(layout.components[0].files).toHaveLength(4);
  });
});

describe('buildRadialLayout -- edge health in components', () => {
  it('component edges carry broken=true when endpoint has errors', () => {
    const files = ['a.ts', 'b.ts'];
    const edges = [edge('a.ts', 'b.ts')];
    const errorFiles = new Set(['a.ts']);
    const layout = buildRadialLayout(files, edges, errorFiles);
    expect(layout.components[0].edges[0].broken).toBe(true);
  });

  it('component edges carry broken=false when no endpoint has errors', () => {
    const files = ['a.ts', 'b.ts'];
    const edges = [edge('a.ts', 'b.ts')];
    const layout = buildRadialLayout(files, edges, noErrors);
    expect(layout.components[0].edges[0].broken).toBe(false);
  });
});

// -- componentRadius ----------------------------------------------------------
describe('componentRadius', () => {
  it('returns MIN_RADIUS for 0 or negative member counts', () => {
    expect(componentRadius(0)).toBe(MIN_RADIUS_PX);
    expect(componentRadius(-1)).toBe(MIN_RADIUS_PX);
  });

  it('returns MIN_RADIUS for very small member counts (circumference would be tiny)', () => {
    expect(componentRadius(1)).toBe(MIN_RADIUS_PX);
    expect(componentRadius(3)).toBe(MIN_RADIUS_PX);
  });

  it('radius grows with member count beyond the minimum arc threshold', () => {
    const smallR = componentRadius(10);
    const bigR   = componentRadius(80);
    expect(bigR).toBeGreaterThan(smallR);
  });

  it('radius is capped at MAX_RADIUS_PX for very large member counts', () => {
    expect(componentRadius(10000)).toBe(MAX_RADIUS_PX);
  });

  it('radius equals ceil(memberCount * MIN_ARC_PX / (2*PI)) for mid-range counts', () => {
    const expected = Math.min(MAX_RADIUS_PX, Math.max(MIN_RADIUS_PX, Math.ceil((50 * MIN_ARC_PX) / (2 * Math.PI))));
    expect(componentRadius(50)).toBe(expected);
  });
});

// -- shouldShowLabel ----------------------------------------------------------
describe('shouldShowLabel', () => {
  const emptyNeighbours = new Set<string>();

  it('always shows label when memberCount <= LABEL_THRESHOLD', () => {
    expect(shouldShowLabel(LABEL_THRESHOLD, 'a.ts', null, emptyNeighbours)).toBe(true);
    expect(shouldShowLabel(1, 'a.ts', null, emptyNeighbours)).toBe(true);
    expect(shouldShowLabel(LABEL_THRESHOLD, 'x.ts', 'other.ts', emptyNeighbours)).toBe(true);
  });

  it('hides label when memberCount > LABEL_THRESHOLD and node is not focused/neighbour', () => {
    expect(shouldShowLabel(LABEL_THRESHOLD + 1, 'a.ts', null, emptyNeighbours)).toBe(false);
    expect(shouldShowLabel(100, 'z.ts', 'other.ts', emptyNeighbours)).toBe(false);
  });

  it('shows label for the focused file even in a large component', () => {
    expect(shouldShowLabel(100, 'focus.ts', 'focus.ts', emptyNeighbours)).toBe(true);
  });

  it('shows label for a direct neighbour of the focused/hovered file in a large component', () => {
    const neighbours = new Set(['neighbour.ts', 'other-neighbour.ts']);
    expect(shouldShowLabel(100, 'neighbour.ts', 'focus.ts', neighbours)).toBe(true);
    expect(shouldShowLabel(100, 'other-neighbour.ts', 'focus.ts', neighbours)).toBe(true);
  });
});

// -- folderKeyOf (IG-27) -------------------------------------------------------
describe('folderKeyOf', () => {
  it('returns the known top-level folder key for recognised prefixes', () => {
    expect(folderKeyOf('app/Foo.php')).toBe('app');
    expect(folderKeyOf('application/Bar.php')).toBe('application');
    expect(folderKeyOf('routes/web.php')).toBe('routes');
    expect(folderKeyOf('resources/views/x.blade.php')).toBe('resources');
    expect(folderKeyOf('database/migrations/m.php')).toBe('database');
    expect(folderKeyOf('src/index.ts')).toBe('src');
    expect(folderKeyOf('system/core.php')).toBe('system');
  });

  it('returns "other" for unrecognised top-level folders', () => {
    expect(folderKeyOf('vendor/foo/Bar.php')).toBe('other');
    expect(folderKeyOf('tests/unit/FooTest.php')).toBe('other');
    expect(folderKeyOf('flat.ts')).toBe('other');
  });

  it('handles empty / edge-case paths gracefully', () => {
    expect(folderKeyOf('')).toBe('other');
  });
});

// -- buildFolderLayout (IG-27) ------------------------------------------------
describe('buildFolderLayout', () => {
  it('returns empty layout for empty file list', () => {
    const layout = buildFolderLayout([], [], noErrors);
    expect(layout.components).toHaveLength(0);
    expect(layout.unlinked.files).toHaveLength(0);
  });

  it('puts linked files into folder-keyed circles', () => {
    const files = ['app/A.php', 'app/B.php', 'routes/R.php', 'lone.php'];
    const edges = [
      edge('app/A.php', 'app/B.php'),
      edge('app/A.php', 'routes/R.php'),
    ];
    const layout = buildFolderLayout(files, edges, noErrors);
    expect(layout.components).toHaveLength(2);
    const appComp = layout.components.find((c) => c.files.includes('app/A.php'));
    expect(appComp).toBeTruthy();
    expect(appComp!.files.sort()).toEqual(['app/A.php', 'app/B.php']);
    const routesComp = layout.components.find((c) => c.files.includes('routes/R.php'));
    expect(routesComp).toBeTruthy();
  });

  it('places unlinked files in the unlinked group, not in any circle', () => {
    const files = ['app/A.php', 'app/B.php', 'lone.php'];
    const edges = [edge('app/A.php', 'app/B.php')];
    const layout = buildFolderLayout(files, edges, noErrors);
    expect(layout.unlinked.files).toEqual(['lone.php']);
    const allComp = layout.components.flatMap((c) => c.files);
    expect(allComp).not.toContain('lone.php');
  });

  it('orders components largest-first', () => {
    const files = [
      'app/A.php', 'app/B.php', 'app/C.php',
      'routes/R.php',
    ];
    const edges = [
      edge('app/A.php', 'app/B.php'),
      edge('app/B.php', 'app/C.php'),
      edge('routes/R.php', 'app/A.php'),
    ];
    const layout = buildFolderLayout(files, edges, noErrors);
    expect(layout.components[0].files.length).toBeGreaterThanOrEqual(
      layout.components[1].files.length,
    );
  });

  it('drops external pkg: / php: edges', () => {
    const files = ['app/A.php', 'app/B.php'];
    const edges = [
      edge('app/A.php', 'pkg:lodash'),
      edge('app/A.php', 'app/B.php'),
    ];
    const layout = buildFolderLayout(files, edges, noErrors);
    expect(layout.components).toHaveLength(1);
    expect(layout.components[0].files.sort()).toEqual(['app/A.php', 'app/B.php']);
  });
});

// -- buildDrillComponent (IG-27) ----------------------------------------------
describe('buildDrillComponent', () => {
  const rawEdges = [
    edge('a.ts', 'b.ts'),
    edge('b.ts', 'c.ts'),
    edge('d.ts', 'b.ts'),
    edge('e.ts', 'f.ts'),
  ];
  const drillEdges = classifyEdges(rawEdges, noErrors);

  it('drill on b.ts includes b + direct neighbours', () => {
    const comp = buildDrillComponent('b.ts', drillEdges);
    expect(comp.files.sort()).toEqual(['a.ts', 'b.ts', 'c.ts', 'd.ts']);
  });

  it('drill edges only contain intra-circle edges', () => {
    const comp = buildDrillComponent('b.ts', drillEdges);
    expect(comp.edges).toHaveLength(3);
    for (const e of comp.edges) {
      expect(comp.files).toContain(e.from);
      expect(comp.files).toContain(e.to);
    }
  });

  it('drill on isolated node returns just that node with no edges', () => {
    const comp = buildDrillComponent('x.ts', drillEdges);
    expect(comp.files).toEqual(['x.ts']);
    expect(comp.edges).toHaveLength(0);
  });

  it('3-deep drill chain state transitions work correctly', () => {
    const step1 = buildDrillComponent('b.ts', drillEdges);
    expect(step1.files.sort()).toEqual(['a.ts', 'b.ts', 'c.ts', 'd.ts']);

    const step2 = buildDrillComponent('a.ts', drillEdges);
    expect(step2.files.sort()).toEqual(['a.ts', 'b.ts']);

    const step3 = buildDrillComponent('b.ts', drillEdges);
    expect(step3.files.sort()).toEqual(['a.ts', 'b.ts', 'c.ts', 'd.ts']);
  });
});

// -- unlinked files excluded from component circles ---------------------------
describe('buildRadialLayout -- unlinked files never in components', () => {
  it('unlinked files are not present in any component file list', () => {
    const files = ['a.ts', 'b.ts', 'lone1.ts', 'lone2.ts', 'lone3.ts'];
    const edges = [edge('a.ts', 'b.ts')];
    const layout = buildRadialLayout(files, edges, noErrors);
    const allComponentFiles = layout.components.flatMap((c) => c.files);
    for (const u of layout.unlinked.files) {
      expect(allComponentFiles).not.toContain(u);
    }
  });

  it('large unlinked set does not inflate component count', () => {
    const loneFiles = Array.from({ length: 3533 }, (_, i) => `lone/file${i}.php`);
    const files = ['a.ts', 'b.ts', ...loneFiles];
    const edges = [edge('a.ts', 'b.ts')];
    const layout = buildRadialLayout(files, edges, noErrors);
    expect(layout.components).toHaveLength(1);
    expect(layout.unlinked.files).toHaveLength(3533);
    expect(layout.components[0].files.sort()).toEqual(['a.ts', 'b.ts']);
  });
});

describe('layoutLeavesHierarchical (IG-14)', () => {
  const polar = (angle: number, r: number, cx: number, cy: number): [number, number] => [
    cx + r * Math.sin(angle),
    cy - r * Math.cos(angle),
  ];

  it('groups sibling folders into contiguous arc sectors', () => {
    const root = buildHierarchy([
      'app/controllers/A.php',
      'app/controllers/B.php',
      'app/models/M.php',
      'lib/util.php',
    ]);
    const positions = layoutLeavesHierarchical(root, 80, 100, 100, polar);
    expect(positions).toHaveLength(4);
    const byFolder = {
      controllers: positions.filter((p) => p.node.id.includes('controllers')).map((p) => p.angle),
      models: positions.filter((p) => p.node.id.includes('models')).map((p) => p.angle),
      lib: positions.filter((p) => p.node.id.startsWith('lib')).map((p) => p.angle),
    };
    const ctrlSpan = Math.max(...byFolder.controllers) - Math.min(...byFolder.controllers);
    const modelAngle = byFolder.models[0];
    const libAngle = byFolder.lib[0];
    expect(ctrlSpan).toBeLessThan(Math.PI);
    expect(Math.abs(byFolder.controllers[0] - byFolder.controllers[1])).toBeLessThan(
      Math.abs(byFolder.controllers[0] - libAngle),
    );
    // app/models is a sibling of app/controllers, so it must sit inside the same
    // parent sector — closer than the unrelated top-level lib/ folder.
    expect(Math.abs(byFolder.controllers[0] - modelAngle)).toBeLessThan(
      Math.abs(byFolder.controllers[0] - libAngle),
    );
    expect(countLeaves(root)).toBe(4);
  });
});

describe('buildFolderLayout (IG-14)', () => {
  it('only includes intra-folder edges in each circle', () => {
    const files = ['application/A.php', 'system/B.php'];
    const edges = [edge('application/A.php', 'system/B.php')];
    const layout = buildFolderLayout(files, edges, noErrors);
    expect(layout.components).toHaveLength(2);
    for (const comp of layout.components) {
      expect(comp.edges).toHaveLength(0);
      expect(comp.groupKey).toBeTruthy();
    }
  });

  it('keeps edges when both endpoints share a folder', () => {
    const files = ['application/A.php', 'application/B.php', 'system/C.php'];
    const edges = [edge('application/A.php', 'application/B.php')];
    const layout = buildFolderLayout(files, edges, noErrors);
    const app = layout.components.find((c) => c.groupKey === 'application');
    expect(app?.edges).toHaveLength(1);
  });
});

describe('radialPerformanceProfile (IG-14 perf)', () => {
  it('allows full detail for small linked sets', () => {
    const p = radialPerformanceProfile(30);
    expect(p.tier).toBe('small');
    expect(p.dotsOnly).toBe(false);
    expect(p.straightEdges).toBe(false);
  });

  it('caps leaves and simplifies paths for huge linked sets', () => {
    const p = radialPerformanceProfile(400);
    expect(p.tier).toBe('huge');
    expect(p.dotsOnly).toBe(true);
    expect(p.straightEdges).toBe(true);
    expect(p.maxLeavesPerCircle).toBeLessThan(50);
  });

  it('prioritises error files when capping leaves', () => {
    const files = Array.from({ length: 10 }, (_, i) => `app/f${i}.php`);
    const edges = files.slice(0, 9).map((f, i) => edge(f, files[i + 1]));
    const classified = classifyEdges(edges, new Set(['app/f9.php']));
    const { files: kept } = capRadialComponentFiles(files, classified, new Set(['app/f9.php']), 5);
    expect(kept).toContain('app/f9.php');
    expect(kept).toHaveLength(5);
  });

  it('rebuilds hierarchy when applying render cap', () => {
    const files = Array.from({ length: 60 }, (_, i) => `app/f${i}.php`);
    const edges = files.slice(0, 59).map((f, i) => edge(f, files[i + 1]));
    const layout = buildRadialLayout(files, edges, noErrors);
    const profile = radialPerformanceProfile(300);
    const { component, cappedLeaves } = applyRadialRenderCap(layout.components[0], profile, noErrors);
    expect(cappedLeaves).toBeGreaterThan(0);
    expect(component.files.length).toBeLessThan(files.length);
    expect(capRadialEdges(component.edges, new Set(component.files), profile.maxEdgesPerCircle).length)
      .toBeLessThanOrEqual(profile.maxEdgesPerCircle);
  });
});
