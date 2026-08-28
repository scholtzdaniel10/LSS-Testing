import { useEffect, useMemo, useRef, useState } from 'react';
import type { GraphEdge } from '../api/client';
import type { GraphView, StackProfile } from './graphModel';
import {
  cacheKeyForRequest,
  EMPTY_GRAPH_VIEW,
  EMPTY_RADIAL_LAYOUT,
  handleModelJob,
  type GraphViewRequest,
  type ModelJob,
  type ModelRequest,
  type ModelResult,
  type RadialLayoutRequest,
} from './modelJobs';
import type { RadialLayout } from './radialModel';

export type ModelStatus = 'idle' | 'loading' | 'ready' | 'error';

type ModelWorkerLike = {
  postMessage: (job: ModelJob) => void;
  addEventListener: (type: 'message' | 'error', listener: EventListener) => void;
  removeEventListener: (type: 'message' | 'error', listener: EventListener) => void;
  terminate: () => void;
};

class InlineModelWorker implements ModelWorkerLike {
  private listeners = new Set<EventListener>();

  postMessage(job: ModelJob): void {
    queueMicrotask(() => {
      try {
        const result = handleModelJob(job);
        const event = { data: result } as MessageEvent<ModelResult>;
        for (const listener of this.listeners) listener(event);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Model worker failed';
        const event = {
          data: { kind: 'error', requestId: job.requestId, message },
        } as MessageEvent<ModelResult>;
        for (const listener of this.listeners) listener(event);
      }
    });
  }

  addEventListener(type: 'message' | 'error', listener: EventListener): void {
    if (type === 'message') this.listeners.add(listener);
  }

  removeEventListener(type: 'message' | 'error', listener: EventListener): void {
    this.listeners.delete(listener);
  }

  terminate(): void {
    this.listeners.clear();
  }
}

const resultCache = new Map<string, GraphView | RadialLayout>();
let sharedWorker: ModelWorkerLike | null = null;
let nextRequestId = 1;
let testFactory: (() => ModelWorkerLike) | null = null;

function createWorker(): ModelWorkerLike {
  if (testFactory) return testFactory();
  if (typeof Worker !== 'undefined') {
    try {
      return new Worker(new URL('../workers/modelWorker.ts', import.meta.url), { type: 'module' });
    } catch {
      // jsdom / hosts without module workers
    }
  }
  return new InlineModelWorker();
}

function getWorker(): ModelWorkerLike {
  if (!sharedWorker) sharedWorker = createWorker();
  return sharedWorker;
}

export function resetModelWorkerForTests(): void {
  sharedWorker?.terminate();
  sharedWorker = null;
  resultCache.clear();
  nextRequestId = 1;
}

export function setModelWorkerFactoryForTests(factory: (() => ModelWorkerLike) | null): void {
  testFactory = factory;
  resetModelWorkerForTests();
}

function useModelJob<T extends GraphView | RadialLayout>(
  request: ModelRequest | null,
  empty: T,
): { status: ModelStatus; data: T | null; error: string | null } {
  const key = request ? cacheKeyForRequest(request) : null;
  const cached = key ? (resultCache.get(key) as T | undefined) : undefined;
  const [status, setStatus] = useState<ModelStatus>(() => {
    if (!request) return 'idle';
    return cached ? 'ready' : 'loading';
  });
  const [data, setData] = useState<T | null>(() => cached ?? null);
  const [error, setError] = useState<string | null>(null);
  const latestId = useRef(0);

  useEffect(() => {
    if (!request || !key) {
      setStatus('idle');
      setData(null);
      setError(null);
      return;
    }
    const hit = resultCache.get(key) as T | undefined;
    if (hit) {
      setStatus('ready');
      setData(hit);
      setError(null);
      return;
    }

    const requestId = nextRequestId++;
    latestId.current = requestId;
    setStatus('loading');
    setError(null);

    const worker = getWorker();
    const onMessage = (event: Event) => {
      const result = (event as MessageEvent<ModelResult>).data;
      if (!result || result.requestId !== requestId) return;
      if (latestId.current !== requestId) return;
      if (result.kind === 'error') {
        setStatus('error');
        setError(result.message);
        setData(null);
        return;
      }
      const value = (result.kind === 'graphView' ? result.view : result.layout) as T;
      resultCache.set(key, value);
      setData(value);
      setStatus('ready');
      setError(null);
    };
    worker.addEventListener('message', onMessage);
    worker.postMessage({ ...request, requestId });
    return () => {
      worker.removeEventListener('message', onMessage);
    };
  }, [key, request]);

  return {
    status,
    data: data ?? (status === 'ready' ? empty : data),
    error,
  };
}

export function useGraphView(input: {
  snapshotId: string;
  edges: GraphEdge[];
  files: string[];
  errorFiles: Map<string, number>;
  expanded: ReadonlySet<string>;
  showExternal: boolean;
  profile: StackProfile;
}): { status: ModelStatus; data: GraphView | null; error: string | null } {
  const errorEntries = useMemo(
    () => [...input.errorFiles.entries()].sort(([a], [b]) => a.localeCompare(b)),
    [input.errorFiles],
  );
  const expanded = useMemo(() => [...input.expanded].sort(), [input.expanded]);
  const request = useMemo<GraphViewRequest>(
    () => ({
      kind: 'graphView',
      snapshotId: input.snapshotId,
      edges: input.edges,
      files: input.files,
      errorFiles: errorEntries,
      expanded,
      showExternal: input.showExternal,
      profile: input.profile,
    }),
    [
      input.snapshotId,
      input.edges,
      input.files,
      errorEntries,
      expanded,
      input.showExternal,
      input.profile,
    ],
  );
  return useModelJob(request, EMPTY_GRAPH_VIEW);
}

export function useRadialLayout(input: {
  snapshotId: string;
  grouping: 'component' | 'folder';
  files: string[];
  edges: GraphEdge[];
  errorFiles: ReadonlySet<string>;
}): { status: ModelStatus; data: RadialLayout | null; error: string | null } {
  const errorFiles = useMemo(
    () => [...input.errorFiles].sort(),
    [input.errorFiles],
  );
  const request = useMemo<RadialLayoutRequest>(
    () => ({
      kind: 'radialLayout',
      snapshotId: input.snapshotId,
      grouping: input.grouping,
      files: input.files,
      edges: input.edges,
      errorFiles,
    }),
    [input.snapshotId, input.grouping, input.files, input.edges, errorFiles],
  );
  return useModelJob(request, EMPTY_RADIAL_LAYOUT);
}

export type { ModelWorkerLike };
