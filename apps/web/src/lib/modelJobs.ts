import type { GraphEdge } from '../api/client';
import {
  buildGraphView,
  type GraphView,
  type StackProfile,
} from './graphModel';
import {
  buildFolderLayout,
  buildRadialLayout,
  type RadialLayout,
} from './radialModel';

export type GraphViewRequest = {
  kind: 'graphView';
  snapshotId: string;
  edges: GraphEdge[];
  files: string[];
  errorFiles: [string, number][];
  expanded: string[];
  showExternal: boolean;
  profile: StackProfile;
};

export type RadialLayoutRequest = {
  kind: 'radialLayout';
  snapshotId: string;
  grouping: 'component' | 'folder';
  files: string[];
  edges: GraphEdge[];
  errorFiles: string[];
};

export type ModelRequest = GraphViewRequest | RadialLayoutRequest;

export type ModelJob = ModelRequest & { requestId: number };

export type GraphViewResult = {
  kind: 'graphView';
  requestId: number;
  view: GraphView;
};

export type RadialLayoutResult = {
  kind: 'radialLayout';
  requestId: number;
  layout: RadialLayout;
};

export type ModelErrorResult = {
  kind: 'error';
  requestId: number;
  message: string;
};

export type ModelSuccess = GraphViewResult | RadialLayoutResult;
export type ModelResult = ModelSuccess | ModelErrorResult;

export const EMPTY_GRAPH_VIEW: GraphView = {
  nodes: [],
  links: [],
  folderCount: 0,
  fileNodeCount: 0,
  hiddenExternal: 0,
};

export const EMPTY_RADIAL_LAYOUT: RadialLayout = {
  components: [],
  unlinked: { files: [] },
};

/** Cache key = snapshot id + view params (not the full edge/file blobs). */
export function cacheKeyForRequest(request: ModelRequest): string {
  if (request.kind === 'graphView') {
    const expanded = [...request.expanded].sort().join('\n');
    const errors = request.errorFiles
      .map(([path, count]) => `${path}:${count}`)
      .sort()
      .join('\n');
    const frameworks = request.profile.frameworks.join(',');
    return [
      'graphView',
      request.snapshotId,
      request.showExternal ? '1' : '0',
      frameworks,
      expanded,
      errors,
    ].join('|');
  }
  const errors = [...request.errorFiles].sort().join('\n');
  return ['radialLayout', request.snapshotId, request.grouping, errors].join('|');
}

export function handleModelJob(job: ModelJob): ModelSuccess {
  if (job.kind === 'graphView') {
    return {
      kind: 'graphView',
      requestId: job.requestId,
      view: buildGraphView(
        job.edges,
        job.files,
        new Map(job.errorFiles),
        new Set(job.expanded),
        job.showExternal,
        job.profile,
      ),
    };
  }
  const errorFiles = new Set(job.errorFiles);
  const layout =
    job.grouping === 'folder'
      ? buildFolderLayout(job.files, job.edges, errorFiles)
      : buildRadialLayout(job.files, job.edges, errorFiles);
  return { kind: 'radialLayout', requestId: job.requestId, layout };
}
