import { renderHook, waitFor, act } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { buildStackProfile } from './graphModel';
import { handleModelJob, type ModelJob, type ModelResult } from './modelJobs';
import {
  resetModelWorkerForTests,
  setModelWorkerFactoryForTests,
  useGraphView,
  type ModelWorkerLike,
} from './useModelWorker';
import type { GraphEdge } from '../api/client';

const edge = (from: string, to: string): GraphEdge => ({ from, to, kind: 'import' });
const files = ['app/A.php', 'lib/C.php'];
const edges = [edge('app/A.php', 'lib/C.php'), edge('app/A.php', 'pkg:foo')];
const profile = buildStackProfile([]);

function countingWorker(): { worker: ModelWorkerLike; posts: ModelJob[] } {
  const posts: ModelJob[] = [];
  const listeners = new Set<EventListener>();
  const worker: ModelWorkerLike = {
    postMessage(job: ModelJob) {
      posts.push(job);
      queueMicrotask(() => {
        const result = handleModelJob(job);
        const event = { data: result } as MessageEvent<ModelResult>;
        for (const listener of listeners) listener(event);
      });
    },
    addEventListener(type, listener) {
      if (type === 'message') listeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === 'message') listeners.delete(listener);
    },
    terminate() {
      listeners.clear();
    },
  };
  return { worker, posts };
}

afterEach(() => {
  setModelWorkerFactoryForTests(null);
  resetModelWorkerForTests();
});

describe('useGraphView', () => {
  it('posts once and reuses the cache for the same snapshot id + view params', async () => {
    const { worker, posts } = countingWorker();
    setModelWorkerFactoryForTests(() => worker);

    const { result, rerender } = renderHook(
      (props: { showExternal: boolean }) =>
        useGraphView({
          snapshotId: 'p1:t1',
          edges,
          files,
          errorFiles: new Map(),
          expanded: new Set<string>(),
          showExternal: props.showExternal,
          profile,
        }),
      { initialProps: { showExternal: false } },
    );

    await waitFor(() => expect(result.current.status).toBe('ready'));
    const postsAfterFirst = posts.length;
    expect(postsAfterFirst).toBeGreaterThanOrEqual(1);
    const firstView = result.current.data;

    rerender({ showExternal: false });
    expect(result.current.status).toBe('ready');
    expect(result.current.data).toBe(firstView);
    expect(posts).toHaveLength(postsAfterFirst);
  });

  it('starts in loading then becomes ready (main thread is not blocked by a sync build)', async () => {
    const { worker } = countingWorker();
    setModelWorkerFactoryForTests(() => worker);

    const { result } = renderHook(() =>
      useGraphView({
        snapshotId: 'p1:t1',
        edges,
        files,
        errorFiles: new Map(),
        expanded: new Set<string>(),
        showExternal: false,
        profile,
      }),
    );

    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.data?.folderCount).toBeGreaterThan(0);
  });

  it('ignores stale jobs when view params change quickly', async () => {
    const listeners = new Set<EventListener>();
    const pending = new Map<number, ModelJob>();
    const worker: ModelWorkerLike = {
      postMessage(job: ModelJob) {
        pending.set(job.requestId, job);
      },
      addEventListener(type, listener) {
        if (type === 'message') listeners.add(listener);
      },
      removeEventListener(type, listener) {
        if (type === 'message') listeners.delete(listener);
      },
      terminate() {
        listeners.clear();
      },
    };
    setModelWorkerFactoryForTests(() => worker);

    const { result, rerender } = renderHook(
      (props: { showExternal: boolean }) =>
        useGraphView({
          snapshotId: 'p1:t1',
          edges,
          files,
          errorFiles: new Map(),
          expanded: new Set<string>(),
          showExternal: props.showExternal,
          profile,
        }),
      { initialProps: { showExternal: false } },
    );

    expect(pending.size).toBe(1);
    const firstId = [...pending.keys()][0];
    rerender({ showExternal: true });
    expect(pending.size).toBe(2);
    const secondId = [...pending.keys()].find((id) => id !== firstId)!;

    const firstJob = pending.get(firstId)!;
    const secondJob = pending.get(secondId)!;
    const flush = (job: ModelJob) => {
      act(() => {
        const event = { data: handleModelJob(job) } as MessageEvent<ModelResult>;
        for (const listener of listeners) listener(event);
      });
    };
    flush(firstJob);
    flush(secondJob);

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.data?.hiddenExternal).toBe(0);
  });

  it('surfaces worker errors', async () => {
    const listeners = new Set<EventListener>();
    const worker: ModelWorkerLike = {
      postMessage(job: ModelJob) {
        queueMicrotask(() => {
          const event = {
            data: { kind: 'error', requestId: job.requestId, message: 'boom' },
          } as MessageEvent<ModelResult>;
          for (const listener of listeners) listener(event);
        });
      },
      addEventListener(type, listener) {
        if (type === 'message') listeners.add(listener);
      },
      removeEventListener(type, listener) {
        if (type === 'message') listeners.delete(listener);
      },
      terminate() {
        listeners.clear();
      },
    };
    setModelWorkerFactoryForTests(() => worker);

    const { result } = renderHook(() =>
      useGraphView({
        snapshotId: 'p1:t1',
        edges,
        files,
        errorFiles: new Map(),
        expanded: new Set<string>(),
        showExternal: false,
        profile,
      }),
    );

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('boom');
  });
});
