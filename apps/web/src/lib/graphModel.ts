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

export type GraphNodeKind = 'file' | 'folder' | 'external';

export type ForceGraphNode = {
  id: string;
  name: string;
  kind: GraphNodeKind;
  /** Path of the folder this node represents (folder nodes only). */
  folderPath?: string;
  folder: string;
  external: boolean;
  errors: number;
  inDegree: number;
  degree: number;
  /** Files rolled up under a folder node; 1 for file/external nodes. */
  fileCount: number;
  color: string;
  /** d3-force positions (set at runtime). */
  x?: number;
  y?: number;
};

export type ForceGraphLink = {
  source: string;
  target: string;
  weight: number;
  externalTarget: boolean;
};

export type GraphView = {
  nodes: ForceGraphNode[];
  links: ForceGraphLink[];
  folderCount: number;
  fileNodeCount: number;
  hiddenExternal: number;
};

// A folder view stays clean because it collapses thousands of files into a
// handful of module nodes; only when the total (after drill-down) blows past
// this do we rank file nodes by importance and trim, so expanding a huge folder
// can't re-clutter the canvas.
const MAX_NODES = 320;

const FOLDER_PREFIX = 'dir:';

/**
 * Map a file path to the node it belongs to given the set of expanded folders.
 * With nothing expanded, `application/controllers/Foo.php` collapses to the
 * `application` folder node; expanding `application` drops it to
 * `application/controllers`; expanding that too yields the file itself.
 */
function collapseFile(
  path: string,
  expanded: Set<string>,
): { id: string; kind: 'file' | 'folder'; folderPath?: string } {
  const parts = path.split('/');
  let acc = '';
  for (let i = 0; i < parts.length - 1; i++) {
    acc = i === 0 ? parts[i] : `${acc}/${parts[i]}`;
    if (!expanded.has(acc)) {
      return { id: `${FOLDER_PREFIX}${acc}`, kind: 'folder', folderPath: acc };
    }
  }
  return { id: path, kind: 'file' };
}

export function buildGraphView(
  edges: GraphEdge[],
  allFiles: string[],
  errorFiles: Map<string, number>,
  expandedFolders: Set<string>,
  showExternal: boolean,
): GraphView {
  const nodes = new Map<string, ForceGraphNode>();

  const ensureFolder = (folderPath: string) => {
    const id = `${FOLDER_PREFIX}${folderPath}`;
    let node = nodes.get(id);
    if (!node) {
      const bucket = folderOf(folderPath);
      const leaf = folderPath.split('/').pop() ?? folderPath;
      node = {
        id,
        name: `${leaf}/`,
        kind: 'folder',
        folderPath,
        folder: bucket,
        external: false,
        errors: 0,
        inDegree: 0,
        degree: 0,
        fileCount: 0,
        color: FOLDER_COLORS[bucket] ?? FOLDER_COLORS.other,
      };
      nodes.set(id, node);
    }
    return node;
  };

  const ensureFile = (path: string) => {
    let node = nodes.get(path);
    if (!node) {
      const bucket = folderOf(path);
      node = {
        id: path,
        name: path.split('/').pop() ?? path,
        kind: 'file',
        folder: bucket,
        external: false,
        errors: errorFiles.get(path) ?? 0,
        inDegree: 0,
        degree: 0,
        fileCount: 1,
        color: FOLDER_COLORS[bucket] ?? FOLDER_COLORS.other,
      };
      nodes.set(path, node);
    }
    return node;
  };

  const ensureExternal = (id: string) => {
    let node = nodes.get(id);
    if (!node) {
      const label = id.startsWith('php:') ? (id.slice(4).split('\\').pop() ?? id) : id.slice(4);
      node = {
        id,
        name: label,
        kind: 'external',
        folder: 'other',
        external: true,
        errors: 0,
        inDegree: 0,
        degree: 0,
        fileCount: 1,
        color: '#302e2c',
      };
      nodes.set(id, node);
    }
    return node;
  };

  // 1. Roll every known file up to its current folder/file node.
  for (const path of allFiles) {
    const target = collapseFile(path, expandedFolders);
    if (target.kind === 'folder' && target.folderPath) {
      const folder = ensureFolder(target.folderPath);
      folder.fileCount += 1;
      folder.errors += errorFiles.get(path) ?? 0;
    } else {
      ensureFile(path);
    }
  }

  // 2. Aggregate edges between the resulting nodes.
  const mapEndpoint = (id: string): ForceGraphNode | null => {
    if (isExternalRef(id)) return showExternal ? ensureExternal(id) : null;
    const target = collapseFile(id, expandedFolders);
    return target.kind === 'folder' && target.folderPath
      ? ensureFolder(target.folderPath)
      : ensureFile(id);
  };

  let hiddenExternal = 0;
  const linkWeights = new Map<string, ForceGraphLink>();
  for (const e of edges) {
    if (!showExternal && (isExternalRef(e.from) || isExternalRef(e.to))) {
      hiddenExternal += 1;
      continue;
    }
    const src = mapEndpoint(e.from);
    const tgt = mapEndpoint(e.to);
    if (!src || !tgt || src.id === tgt.id) continue; // drop self / intra-node edges

    const key = `${src.id} ${tgt.id}`;
    const existing = linkWeights.get(key);
    if (existing) {
      existing.weight += 1;
    } else {
      linkWeights.set(key, {
        source: src.id,
        target: tgt.id,
        weight: 1,
        externalTarget: tgt.kind === 'external',
      });
    }
  }

  // 3. Degrees from the aggregated links (drives node size + ranking).
  for (const link of linkWeights.values()) {
    const s = nodes.get(link.source);
    const t = nodes.get(link.target);
    if (s) s.degree += link.weight;
    if (t) {
      t.degree += link.weight;
      t.inDegree += link.weight;
    }
  }

  // 4. Cap: keep folders/externals, rank files by errors then degree.
  let nodeList = [...nodes.values()];
  if (nodeList.length > MAX_NODES) {
    const keep = new Set<string>();
    const files: ForceGraphNode[] = [];
    for (const n of nodeList) {
      if (n.kind === 'file') files.push(n);
      else keep.add(n.id);
    }
    files.sort((a, b) => (b.errors - a.errors) || (b.degree - a.degree) || a.id.localeCompare(b.id));
    for (const f of files.slice(0, Math.max(0, MAX_NODES - keep.size))) keep.add(f.id);
    nodeList = nodeList.filter((n) => keep.has(n.id));
  }

  const keptIds = new Set(nodeList.map((n) => n.id));
  const links = [...linkWeights.values()].filter((l) => keptIds.has(l.source) && keptIds.has(l.target));

  return {
    nodes: nodeList,
    links,
    folderCount: nodeList.filter((n) => n.kind === 'folder').length,
    fileNodeCount: nodeList.filter((n) => n.kind === 'file').length,
    hiddenExternal,
  };
}

/** Collapsing a folder also collapses anything expanded beneath it. */
export function collapseFolder(expanded: Set<string>, folderPath: string): Set<string> {
  const next = new Set<string>();
  for (const f of expanded) {
    if (f !== folderPath && !f.startsWith(`${folderPath}/`)) next.add(f);
  }
  return next;
}

/**
 * Returns the set of folder paths that must be expanded so that `filePath` is
 * visible as its own file node in the graph.
 *
 * Example: "application/controllers/Foo.php"
 *   -> Set { "application", "application/controllers" }
 */
export function expansionChainForFile(filePath: string): Set<string> {
  const parts = filePath.split('/');
  const chain = new Set<string>();
  let acc = '';
  // Walk every directory segment except the filename (last part).
  for (let i = 0; i < parts.length - 1; i++) {
    acc = i === 0 ? parts[i] : `${acc}/${parts[i]}`;
    chain.add(acc);
  }
  return chain;
}

/**
 * Merge a per-file error count map (path -> count) into an existing
 * `errorFiles` map, returning a new map (does not mutate either input).
 */
export function mergeErrorMaps(
  base: Map<string, number>,
  overlay: Map<string, number>,
): Map<string, number> {
  const result = new Map(base);
  for (const [path, count] of overlay) {
    result.set(path, (result.get(path) ?? 0) + count);
  }
  return result;
}

// ── Collapsible file-tree model ─────────────────────────────────────────────────

export type TreeNodeKind = 'folder' | 'file';

export type TreeNode = {
  /** Slash-separated path (folders: without trailing slash). */
  path: string;
  name: string;
  kind: TreeNodeKind;
  depth: number;
  /** Folder-series key from folderOf(). */
  folder: string;
  /** Aggregate error count (files: direct; folders: sum of children under them). */
  errors: number;
  /** Direct link-edge count for file nodes; 0 for folders. */
  links: number;
  /** Number of direct child nodes (folders only). */
  childCount: number;
};

/**
 * Build a sorted, hierarchical tree from a flat list of file paths.
 *
 * Rules:
 *  - Intermediate folder nodes are synthesized from path segments.
 *  - Children within each folder are sorted folders-first, then alphabetically.
 *  - `expandedFolders` controls which folders expose their children.
 *    By default top-level folders are expanded; everything else is collapsed.
 *  - Only visible nodes (ancestors expanded) are emitted so the caller can
 *    render them directly as a flat list with indented rows.
 */
export function buildFileTree(
  paths: string[],
  expandedFolders: Set<string>,
  linkCount: Map<string, number>,
  errorCount: Map<string, number>,
): TreeNode[] {
  // 1. Collect all unique folder paths and file paths.
  const allFolders = new Set<string>();
  for (const p of paths) {
    const parts = p.split('/');
    // Walk all ancestor directories.
    for (let i = 1; i < parts.length; i++) {
      allFolders.add(parts.slice(0, i).join('/'));
    }
  }

  // 2. Build a children map: parent -> sorted children.
  const children = new Map<string | null, string[]>();
  const addChild = (parent: string | null, child: string) => {
    let arr = children.get(parent);
    if (!arr) {
      arr = [];
      children.set(parent, arr);
    }
    if (!arr.includes(child)) arr.push(child);
  };

  for (const folder of allFolders) {
    const parts = folder.split('/');
    const parent = parts.length === 1 ? null : parts.slice(0, -1).join('/');
    addChild(parent, folder);
  }
  for (const p of paths) {
    const parts = p.split('/');
    const parent = parts.length === 1 ? null : parts.slice(0, -1).join('/');
    addChild(parent, p);
  }

  // Sort each children list: folders first, then alphabetical within each kind.
  const sortChildren = (list: string[]) => {
    list.sort((a, b) => {
      const aIsFolder = allFolders.has(a);
      const bIsFolder = allFolders.has(b);
      if (aIsFolder !== bIsFolder) return aIsFolder ? -1 : 1;
      return a.localeCompare(b);
    });
  };
  for (const list of children.values()) {
    sortChildren(list);
  }

  // 3. Pre-compute aggregate error counts for folders.
  const folderErrors = new Map<string, number>();
  // Process in reverse depth order (deepest first) for correct aggregation.
  const sortedFolders = [...allFolders].sort((a, b) => b.split('/').length - a.split('/').length);
  for (const folder of sortedFolders) {
    let total = 0;
    for (const child of children.get(folder) ?? []) {
      if (allFolders.has(child)) {
        total += folderErrors.get(child) ?? 0;
      } else {
        total += errorCount.get(child) ?? 0;
      }
    }
    folderErrors.set(folder, total);
  }

  // 4. Walk in DFS order, only emitting visible nodes.
  const result: TreeNode[] = [];

  const visit = (path: string | null, depth: number) => {
    const list = children.get(path) ?? [];
    for (const child of list) {
      const isFolder = allFolders.has(child);
      const name = child.split('/').pop() ?? child;
      const folderKey = folderOf(child);

      const node: TreeNode = {
        path: child,
        name,
        kind: isFolder ? 'folder' : 'file',
        depth,
        folder: folderKey,
        errors: isFolder ? (folderErrors.get(child) ?? 0) : (errorCount.get(child) ?? 0),
        links: isFolder ? 0 : (linkCount.get(child) ?? 0),
        childCount: children.get(child)?.length ?? 0,
      };
      result.push(node);

      if (isFolder && expandedFolders.has(child)) {
        visit(child, depth + 1);
      }
    }
  };

  visit(null, 0);
  return result;
}

/**
 * Default expanded set: only top-level folders are expanded.
 */
export function defaultExpandedFolders(paths: string[]): Set<string> {
  const topLevel = new Set<string>();
  for (const p of paths) {
    const top = p.split('/')[0];
    if (top && p.includes('/')) {
      topLevel.add(top);
    }
  }
  return topLevel;
}
