import type { GraphEdge } from '../api/client';

export const folderOf = (path: string) => {
  const top = path.split('/')[0] ?? 'other';
  if (['app', 'application', 'routes', 'resources', 'database', 'src', 'system'].includes(top)) return top;
  return 'other';
};

export const isExternalRef = (id: string) => id.startsWith('pkg:') || id.startsWith('php:');

export const FOLDER_COLORS: Record<string, string> = {
  app: '#4584d3',
  application: '#4584d3',
  routes: '#678838',
  resources: '#c256a0',
  database: '#8a5bd3',
  src: '#4584d3',
  system: '#678838',
  other: '#706e69',
};

export type ForceGraphNode = {
  id: string;
  name: string;
  folder: string;
  external: boolean;
  errors: number;
  inDegree: number;
  color: string;
};

export type ForceGraphLink = {
  source: string;
  target: string;
  externalTarget: boolean;
};

const MAX_FILE_NODES = 60;
const MAX_EXTERNAL_NODES = 24;
const MAX_LINKS = 300;

export function buildForceGraphData(
  edges: GraphEdge[],
  errorFiles: Map<string, number>,
  extraFileIds: string[] = [],
): { nodes: ForceGraphNode[]; links: ForceGraphLink[] } {
  const fileIds = new Set<string>();
  const externalIds = new Set<string>();

  for (const e of edges) {
    if (isExternalRef(e.from)) externalIds.add(e.from);
    else fileIds.add(e.from);
    if (isExternalRef(e.to)) externalIds.add(e.to);
    else fileIds.add(e.to);
  }
  for (const path of extraFileIds.slice(0, MAX_FILE_NODES)) {
    fileIds.add(path);
  }

  const inDegree = new Map<string, number>();
  for (const e of edges) {
    inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
  }

  const nodes: ForceGraphNode[] = [];

  for (const id of [...fileIds].slice(0, MAX_FILE_NODES)) {
    const folder = folderOf(id);
    nodes.push({
      id,
      name: id.split('/').pop() ?? id,
      folder,
      external: false,
      errors: errorFiles.get(id) ?? 0,
      inDegree: inDegree.get(id) ?? 0,
      color: FOLDER_COLORS[folder] ?? FOLDER_COLORS.other,
    });
  }

  for (const id of [...externalIds].slice(0, MAX_EXTERNAL_NODES)) {
    const label = id.startsWith('php:') ? id.slice(4).split('\\').pop() ?? id : id.slice(4);
    nodes.push({
      id,
      name: label,
      folder: 'other',
      external: true,
      errors: 0,
      inDegree: inDegree.get(id) ?? 0,
      color: '#302e2c',
    });
  }

  const nodeIds = new Set(nodes.map((n) => n.id));
  const links: ForceGraphLink[] = edges
    .filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to))
    .slice(0, MAX_LINKS)
    .map((e) => ({
      source: e.from,
      target: e.to,
      externalTarget: isExternalRef(e.to),
    }));

  return { nodes, links };
}
