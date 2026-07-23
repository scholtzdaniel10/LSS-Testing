import { describe, expect, it } from 'vitest';
import { buildModuleGroups, neighbourPaths, MODULE_MAP_FILE_CAP } from './moduleMapModel';
import type { GraphEdge } from '../api/client';

describe('buildModuleGroups', () => {
  const edges: GraphEdge[] = [
    { from: 'app/Foo.php', to: 'app/Bar.php' },
    { from: 'system/Core.php', to: 'app/Foo.php' },
  ];

  it('groups files by top-level folder', () => {
    const files = ['app/Foo.php', 'app/Bar.php', 'system/Core.php', 'readme.md'];
    const { modules, totalFiles } = buildModuleGroups(files, edges, new Set());
    expect(totalFiles).toBe(4);
    const keys = modules.map((m) => m.key).sort();
    expect(keys).toEqual(['app', 'other', 'system']);
    const app = modules.find((m) => m.key === 'app');
    expect(app?.fileCount).toBe(2);
    expect(app?.files.length).toBe(2);
  });

  it('caps total visible files for large trees', () => {
    const files = Array.from({ length: MODULE_MAP_FILE_CAP + 50 }, (_, i) => `app/f${i}.php`);
    const { capped, modules } = buildModuleGroups(files, [], new Set());
    expect(capped).toBe(true);
    const shown = modules.reduce((n, m) => n + m.files.length, 0);
    expect(shown).toBeLessThanOrEqual(MODULE_MAP_FILE_CAP);
  });
});

describe('neighbourPaths', () => {
  it('returns undirected neighbours', () => {
    const edges: GraphEdge[] = [{ from: 'a/x.php', to: 'b/y.php' }];
    expect(neighbourPaths('a/x.php', edges)).toEqual(['b/y.php']);
    expect(neighbourPaths('b/y.php', edges)).toEqual(['a/x.php']);
  });
});
