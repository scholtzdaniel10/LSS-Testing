import type { GraphEdge } from '../api/client';

// ── IG-22: StackProfile ───────────────────────────────────────────────────────

/**
 * IG-22: Lightweight stack profile derived from the UsageReport.
 * Consumed by the graph model to drive folder grouping and colors so that
 * a CI3 project's "application/" folder gets the same treatment as Laravel's
 * "app/", and colors come from the profile rather than a hardcoded map.
 */
export type StackProfile = {
  frameworks: string[];
  /** Folder → design-token variable name (e.g. 'app' → '--series-1'). */
  folderTokens: Record<string, string>;
};

/**
 * Build a StackProfile from a UsageReport frameworks list.
 * Falls back to sensible defaults for unknown stacks.
 */
export function buildStackProfile(frameworks: string[]): StackProfile {
  // Base token map — extended per stack below
  const folderTokens: Record<string, string> = {
    app: '--series-1',
    application: '--series-1',
    routes: '--series-2',
    resources: '--series-3',
    database: '--series-4',
    src: '--series-1',
    system: '--series-2',
    lib: '--series-2',
    components: '--series-3',
    pages: '--series-3',
    services: '--series-4',
    other: '--series-other',
  };

  // Laravel: use app/ as primary
  if (frameworks.includes('laravel')) {
    folderTokens['app'] = '--series-1';
    folderTokens['routes'] = '--series-2';
    folderTokens['resources'] = '--series-3';
    folderTokens['database'] = '--series-4';
  }

  // CI3: application/ = primary, system/ = secondary
  if (frameworks.includes('codeigniter-3')) {
    folderTokens['application'] = '--series-1';
    folderTokens['system'] = '--series-2';
  }

  // React/Ionic: src/components, src/pages prominent
  if (frameworks.includes('react') || frameworks.includes('ionic')) {
    folderTokens['src'] = '--series-1';
    folderTokens['components'] = '--series-3';
    folderTokens['pages'] = '--series-3';
  }

  return { frameworks, folderTokens };
}

/**
 * Resolve the CSS variable string for a given folder using the StackProfile.
 * Returns 'var(--series-other)' for unrecognised folders.
 */
export function folderColor(folderKey: string, profile: StackProfile): string {
  const token = profile.folderTokens[folderKey] ?? '--series-other';
  return `var(${token})`;
}

// ── Legacy FOLDER_COLORS constant for backward compat with existing graph tests ─

/** @deprecated Use folderColor(key, profile) for new code. */
export const FOLDER_COLORS: Record<string, string> = {
  app: 'var(--series-1)',
  application: 'var(--series-1)',
  routes: 'var(--series-2)',
  resources: 'var(--series-3)',
  database: 'var(--series-4)',
  src: 'var(--series-1)',
  system: 'var(--series-2)',
  other: 'var(--series-other)',
};

// ── existing graph logic (unchanged except color resolution) ─────────────────

export const folderOf = (path: string) => {
  const top = path.split('/')[0] ?? 'other';
  if (['app', 'application', 'routes', 'resources', 'database', 'src', 'system',
       'lib', 'components', 'pages', 'services'].includes(top)) return top;
  return 'other';
};

export const isExternalRef = (id: string) =>
  id.startsWith('pkg:') || id.startsWith('php:') || id.startsWith('npm:') || id.startsWith('ext:');

/**
 * IG-22: parse a raw edge `to` field and categorise it.
 * Handles pkg:, php:, npm: prefixes and bare package names.
 */
export function parseExternalRef(to: string): { external: true; label: string } | { external: false } {
  if (to.startsWith('php:')) return { external: true, label: to.slice(4).split('\\').pop() ?? to };
  if (to.startsWith('pkg:') || to.startsWith('npm:') || to.startsWith('ext:')) {
    return { external: true, label: to.slice(4) };
  }
  return { external: false };
}

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

const MAX_NODES = 320;
const FOLDER_PREFIX = 'dir:';

const DEFAULT_PROFILE = buildStackProfile([]);

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
  profile: StackProfile = DEFAULT_PROFILE,
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
        // IG-22: color from StackProfile token
        color: folderColor(bucket, profile),
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
        color: folderColor(bucket, profile),
      };
      nodes.set(path, node);
    }
    return node;
  };

  const ensureExternal = (id: string) => {
    let node = nodes.get(id);
    if (!node) {
      // IG-22: use parseExternalRef to derive a human label
      const parsed = parseExternalRef(id);
      const label = parsed.external ? parsed.label : id;
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
        color: 'var(--surface-raised)',
      };
      nodes.set(id, node);
    }
    return node;
  };

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
    if (!src || !tgt || src.id === tgt.id) continue;

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

  for (const link of linkWeights.values()) {
    const s = nodes.get(link.source);
    const t = nodes.get(link.target);
    if (s) s.degree += link.weight;
    if (t) {
      t.degree += link.weight;
      t.inDegree += link.weight;
    }
  }

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

export function collapseFolder(expanded: Set<string>, folderPath: string): Set<string> {
  const next = new Set<string>();
  for (const f of expanded) {
    if (f !== folderPath && !f.startsWith(`${folderPath}/`)) next.add(f);
  }
  return next;
}

export function expansionChainForFile(filePath: string): Set<string> {
  const parts = filePath.split('/');
  const chain = new Set<string>();
  let acc = '';
  for (let i = 0; i < parts.length - 1; i++) {
    acc = i === 0 ? parts[i] : `${acc}/${parts[i]}`;
    chain.add(acc);
  }
  return chain;
}

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

// ── Collapsible file-tree model ──────────────────────────────────────────────

export type TreeNodeKind = 'folder' | 'file';

export type TreeNode = {
  path: string;
  name: string;
  kind: TreeNodeKind;
  depth: number;
  folder: string;
  errors: number;
  links: number;
  childCount: number;
};

export function buildFileTree(
  paths: string[],
  expandedFolders: Set<string>,
  linkCount: Map<string, number>,
  errorCount: Map<string, number>,
): TreeNode[] {
  const allFolders = new Set<string>();
  for (const p of paths) {
    const parts = p.split('/');
    for (let i = 1; i < parts.length; i++) {
      allFolders.add(parts.slice(0, i).join('/'));
    }
  }

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

  const folderErrors = new Map<string, number>();
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

  const result: TreeNode[] = [];
  const visit = (path: string | null, depth: number) => {
    const list = children.get(path) ?? [];
    for (const child of list) {
      const isFolder = allFolders.has(child);
      const name = child.split('/').pop() ?? child;
      const folderKey = folderOf(child);
      result.push({
        path: child,
        name,
        kind: isFolder ? 'folder' : 'file',
        depth,
        folder: folderKey,
        errors: isFolder ? (folderErrors.get(child) ?? 0) : (errorCount.get(child) ?? 0),
        links: isFolder ? 0 : (linkCount.get(child) ?? 0),
        childCount: children.get(child)?.length ?? 0,
      });
      if (isFolder && expandedFolders.has(child)) {
        visit(child, depth + 1);
      }
    }
  };
  visit(null, 0);
  return result;
}

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
