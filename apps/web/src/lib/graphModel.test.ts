import { describe, expect, it } from 'vitest';
import { buildForceGraphData } from './graphModel';
import type { GraphEdge } from '../api/client';

const edge = (from: string, to: string): GraphEdge => ({ from, to, kind: 'import' });

describe('buildForceGraphData', () => {
  it('includes standalone files that have no edges (so every listed file is a clickable node)', () => {
    const { nodes } = buildForceGraphData([], new Map(), ['app/Lonely.php']);
    expect(nodes.map((n) => n.id)).toContain('app/Lonely.php');
    expect(nodes[0].external).toBe(false);
  });

  it('marks pkg:/php: references external and everything else as a file', () => {
    const { nodes } = buildForceGraphData(
      [edge('app/A.php', 'pkg:guzzlehttp/guzzle'), edge('app/A.php', 'php:App\\Models\\Invoice')],
      new Map(),
    );
    const byId = new Map(nodes.map((n) => [n.id, n]));
    expect(byId.get('app/A.php')?.external).toBe(false);
    expect(byId.get('pkg:guzzlehttp/guzzle')?.external).toBe(true);
    expect(byId.get('php:App\\Models\\Invoice')?.external).toBe(true);
  });

  it('keeps error-bearing files even when many higher-degree files compete for slots', () => {
    // 500 plain files (over the 400 cap) plus one low-degree file that has an error.
    const extras = Array.from({ length: 500 }, (_, i) => `app/File${i}.php`);
    const edges = extras.flatMap((f, i) => (i < 499 ? [edge(f, extras[i + 1])] : []));
    const errored = 'app/File499.php'; // last one, lowest degree
    const { nodes } = buildForceGraphData(edges, new Map([[errored, 3]]), extras);

    const kept = new Set(nodes.filter((n) => !n.external).map((n) => n.id));
    expect(kept.size).toBeLessThanOrEqual(400);
    expect(kept.has(errored)).toBe(true);
  });
});
