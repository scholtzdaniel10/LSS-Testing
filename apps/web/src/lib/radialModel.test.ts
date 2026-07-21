import { describe, expect, it } from 'vitest';
import {
  buildRadialLayout,
  buildHierarchy,
  classifyEdges,
  computeFocusNeighbourhood,
  collectLeaves,
} from './radialModel';
import type { GraphEdge } from '../api/client';

// ── helpers ──────────────────────────────────────────────────────────────────
const edge = (from: string, to: string): GraphEdge => ({ from, to });
const noErrors = new Set<string>();

// ── buildHierarchy ────────────────────────────────────────────────────────────
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

// ── classifyEdges ─────────────────────────────────────────────────────────────
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
    // Warnings are NOT included in the errorFiles set by callers — only errors.
    const result = classifyEdges([edge('a.ts', 'b.ts')], noErrors);
    expect(result[0].broken).toBe(false);
  });

  it('handles empty edge list', () => {
    expect(classifyEdges([], noErrors)).toEqual([]);
  });
});

// ── computeFocusNeighbourhood ─────────────────────────────────────────────────
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

// ── buildRadialLayout ─────────────────────────────────────────────────────────
describe('buildRadialLayout — empty / null cases', () => {
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

describe('buildRadialLayout — connected components', () => {
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
    // Only the internal edge matters; should be 1 component with 2 files.
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

describe('buildRadialLayout — edge health in components', () => {
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
