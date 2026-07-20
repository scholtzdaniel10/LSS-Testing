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
  degree: number;
  color: string;
};

export type ForceGraphLink = {
  source: string;
  target: string;
  externalTarget: boolean;
};

// Canvas force layout stays smooth into the low thousands of marks; these caps
// keep a real project (Estate_Agents_2 ≈ 6,000 edges) legible without dropping
// so many files that "most files aren't even in the graph". When a project has
// more files than the cap, the most-connected and error-bearing files win the
// slots (see rankFiles) rather than an arbitrary first-N.
const MAX_FILE_NODES = 400;
const MAX_EXTERNAL_NODES = 80;
const MAX_LINKS = 1200;

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
  for (const path of extraFileIds) {
    fileIds.add(path);
  }

  // Total degree (in + out) and error count decide which files earn a slot.
  const degree = new Map<string, number>();
  const inDegree = new Map<string, number>();
  const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);
  for (const e of edges) {
    bump(degree, e.from);
    bump(degree, e.to);
    bump(inDegree, e.to);
  }

  const rankFiles = (ids: string[]): string[] =>
    [...ids].sort((a, b) => {
      const errA = errorFiles.get(a) ?? 0;
      const errB = errorFiles.get(b) ?? 0;
      if (errA !== errB) return errB - errA; // error files always kept
      const degDiff = (degree.get(b) ?? 0) - (degree.get(a) ?? 0);
      if (degDiff !== 0) return degDiff;
      return a.localeCompare(b); // stable, deterministic tie-break
    });

  const keptFiles = rankFiles([...fileIds]).slice(0, MAX_FILE_NODES);
  const keptExternal = [...externalIds]
    .sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0))
    .slice(0, MAX_EXTERNAL_NODES);

  const nodes: ForceGraphNode[] = [];

  for (const id of keptFiles) {
    const folder = folderOf(id);
    nodes.push({
      id,
      name: id.split('/').pop() ?? id,
      folder,
      external: false,
      errors: errorFiles.get(id) ?? 0,
      inDegree: inDegree.get(id) ?? 0,
      degree: degree.get(id) ?? 0,
      color: FOLDER_COLORS[folder] ?? FOLDER_COLORS.other,
    });
  }

  for (const id of keptExternal) {
    const label = id.startsWith('php:') ? (id.slice(4).split('\\').pop() ?? id) : id.slice(4);
    nodes.push({
      id,
      name: label,
      folder: 'other',
      external: true,
      errors: 0,
      inDegree: inDegree.get(id) ?? 0,
      degree: degree.get(id) ?? 0,
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
