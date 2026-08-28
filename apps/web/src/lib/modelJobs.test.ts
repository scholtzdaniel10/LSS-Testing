import { describe, expect, it } from 'vitest';
import { buildGraphView, buildStackProfile } from './graphModel';
import { buildFolderLayout, buildRadialLayout } from './radialModel';
import { cacheKeyForRequest, handleModelJob, isEmptyModelValue, EMPTY_GRAPH_VIEW, EMPTY_RADIAL_LAYOUT } from './modelJobs';
import type { GraphEdge } from '../api/client';

const edge = (from: string, to: string): GraphEdge => ({ from, to, kind: 'import' });
const files = ['app/A.php', 'app/B.php', 'lib/C.php'];
const edges = [edge('app/A.php', 'lib/C.php'), edge('app/B.php', 'pkg:guzzle')];
const profile = buildStackProfile(['laravel']);

describe('handleModelJob — parity with pure functions', () => {
  it('matches buildGraphView for the same inputs', () => {
    const errorFiles: [string, number][] = [['app/A.php', 2]];
    const expanded = ['app'];
    const job = handleModelJob({
      kind: 'graphView',
      requestId: 1,
      snapshotId: 'p1:scan',
      edges,
      files,
      errorFiles,
      expanded,
      showExternal: false,
      profile,
    });
    expect(job.kind).toBe('graphView');
    if (job.kind !== 'graphView') return;
    const direct = buildGraphView(edges, files, new Map(errorFiles), new Set(expanded), false, profile);
    expect(job.view).toEqual(direct);
  });

  it('matches buildRadialLayout for component grouping', () => {
    const errorFiles = ['app/A.php'];
    const job = handleModelJob({
      kind: 'radialLayout',
      requestId: 2,
      snapshotId: 'p1:scan',
      grouping: 'component',
      files,
      edges,
      errorFiles,
    });
    expect(job.kind).toBe('radialLayout');
    if (job.kind !== 'radialLayout') return;
    expect(job.layout).toEqual(buildRadialLayout(files, edges, new Set(errorFiles)));
  });

  it('matches buildFolderLayout for folder grouping', () => {
    const errorFiles = ['lib/C.php'];
    const job = handleModelJob({
      kind: 'radialLayout',
      requestId: 3,
      snapshotId: 'p1:scan',
      grouping: 'folder',
      files,
      edges,
      errorFiles,
    });
    expect(job.kind).toBe('radialLayout');
    if (job.kind !== 'radialLayout') return;
    expect(job.layout).toEqual(buildFolderLayout(files, edges, new Set(errorFiles)));
  });
});

describe('cacheKeyForRequest', () => {
  it('is stable for the same snapshot id + view params regardless of array identity', () => {
    const a = cacheKeyForRequest({
      kind: 'graphView',
      snapshotId: 'p1:t1',
      edges,
      files,
      errorFiles: [['app/A.php', 1]],
      expanded: ['lib', 'app'],
      showExternal: true,
      profile,
    });
    const b = cacheKeyForRequest({
      kind: 'graphView',
      snapshotId: 'p1:t1',
      edges: [...edges],
      files: [...files],
      errorFiles: [['app/A.php', 1]],
      expanded: ['app', 'lib'],
      showExternal: true,
      profile,
    });
    expect(a).toBe(b);
  });

  it('changes when snapshot id or view params change', () => {
    const base = {
      kind: 'radialLayout' as const,
      snapshotId: 'p1:t1',
      grouping: 'folder' as const,
      files,
      edges,
      errorFiles: [] as string[],
    };
    expect(cacheKeyForRequest(base)).not.toBe(cacheKeyForRequest({ ...base, snapshotId: 'p1:t2' }));
    expect(cacheKeyForRequest(base)).not.toBe(cacheKeyForRequest({ ...base, grouping: 'component' }));
  });
});

describe('isEmptyModelValue', () => {
  it('treats empty graph views and radial layouts as empty', () => {
    expect(isEmptyModelValue(EMPTY_GRAPH_VIEW)).toBe(true);
    expect(isEmptyModelValue(EMPTY_RADIAL_LAYOUT)).toBe(true);
  });

  it('treats layouts with nodes or components as non-empty', () => {
    expect(isEmptyModelValue({ ...EMPTY_GRAPH_VIEW, nodes: [{ id: 'a' } as never] })).toBe(false);
    expect(isEmptyModelValue({ ...EMPTY_RADIAL_LAYOUT, components: [{ index: 0 } as never] })).toBe(false);
  });
});
