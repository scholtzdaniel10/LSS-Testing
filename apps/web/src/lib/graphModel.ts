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
  /** Pinned position for folder hub nodes during cluster layout. */
  fx?: number;
  fy?: number;
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

const MAX_NODES = 200;
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

// ── IG-13: graph performance tiers (Explore canvas / GPU guards) ─────────────

export type GraphPerfTier = 'small' | 'medium' | 'large' | 'huge';

export type GraphPerformanceProfile = {
  tier: GraphPerfTier;
  /** Cap canvas backing-store scale (1 = css pixels). */
  maxCanvasDpr: number;
  /** Draw rounded label pills only for focused / high-signal nodes when true. */
  sparseLabels: boolean;
  /** Skip label background pills — text only or none. */
  simpleLabelPaint: boolean;
  /** Pin every node after cluster seed so the force sim settles instantly. */
  fixedLayout: boolean;
  /** Directional link arrows (expensive on dense graphs). */
  showLinkArrows: boolean;
  /** Redraw canvas when the hovered node changes. */
  hoverRedraw: boolean;
  /** Max nodes when a focus neighbourhood is expanded on large graphs. */
  maxFocusNodes: number;
  enableNodeDrag: boolean;
  warmupTicks: number;
  cooldownTicks: number;
  cooldownTime: number;
  d3AlphaDecay: number;
  d3VelocityDecay: number;
};

/** Derive force-graph tuning from visible node count (testable, no DOM). */
export function graphPerformanceProfile(nodeCount: number): GraphPerformanceProfile {
  if (nodeCount <= 60) {
    return {
      tier: 'small',
      maxCanvasDpr: 1,
      sparseLabels: false,
      simpleLabelPaint: false,
      fixedLayout: false,
      showLinkArrows: true,
      hoverRedraw: true,
      maxFocusNodes: Number.POSITIVE_INFINITY,
      enableNodeDrag: true,
      warmupTicks: 60,
      cooldownTicks: 100,
      cooldownTime: 12000,
      d3AlphaDecay: 0.024,
      d3VelocityDecay: 0.38,
    };
  }
  if (nodeCount <= 100) {
    return {
      tier: 'medium',
      maxCanvasDpr: 1,
      sparseLabels: true,
      simpleLabelPaint: true,
      fixedLayout: true,
      showLinkArrows: false,
      hoverRedraw: false,
      maxFocusNodes: 96,
      enableNodeDrag: false,
      warmupTicks: 0,
      cooldownTicks: 0,
      cooldownTime: 0,
      d3AlphaDecay: 0.08,
      d3VelocityDecay: 0.5,
    };
  }
  if (nodeCount <= 160) {
    return {
      tier: 'large',
      maxCanvasDpr: 1,
      sparseLabels: true,
      simpleLabelPaint: true,
      fixedLayout: true,
      showLinkArrows: false,
      hoverRedraw: false,
      maxFocusNodes: 72,
      enableNodeDrag: false,
      warmupTicks: 0,
      cooldownTicks: 0,
      cooldownTime: 0,
      d3AlphaDecay: 0.1,
      d3VelocityDecay: 0.55,
    };
  }
  return {
    tier: 'huge',
    maxCanvasDpr: 1,
    sparseLabels: true,
    simpleLabelPaint: true,
    fixedLayout: true,
    showLinkArrows: false,
    hoverRedraw: false,
    maxFocusNodes: 56,
    enableNodeDrag: false,
    warmupTicks: 0,
    cooldownTicks: 0,
    cooldownTime: 0,
    d3AlphaDecay: 0.12,
    d3VelocityDecay: 0.6,
  };
}

/** Node count above which the graph shows an overview cap until the user focuses. */
export const HUGE_GRAPH_OVERVIEW_THRESHOLD = 100;

/**
 * When the graph is huge and nothing is selected, keep folder hubs, error files,
 * and the highest-degree file nodes so the canvas stays a scannable graph.
 */
export function hugeGraphOverviewKeep(
  nodes: readonly ForceGraphNode[],
  fileCap = 40,
): Set<string> {
  const keep = new Set<string>();
  const rankedFiles: ForceGraphNode[] = [];

  for (const n of nodes) {
    if (n.kind === 'folder' || n.errors > 0 || n.external) {
      keep.add(n.id);
      continue;
    }
    if (n.kind === 'file') rankedFiles.push(n);
  }

  rankedFiles.sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id));
  for (const f of rankedFiles.slice(0, fileCap)) keep.add(f.id);
  return keep;
}

// ── IG-13: neighbourhood focus + search helpers ───────────────────────────────

/** Build an undirected adjacency map from force-graph links. */
export function buildNeighbourMap(links: readonly ForceGraphLink[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const add = (a: string, b: string) => {
    if (!map.has(a)) map.set(a, new Set());
    map.get(a)!.add(b);
  };
  for (const l of links) {
    add(l.source, l.target);
    add(l.target, l.source);
  }
  return map;
}

/** Nodes within `depth` hops of `rootId` (root included). */
export function neighbourhoodWithin(
  rootId: string,
  neighbours: Map<string, Set<string>>,
  depth: number,
): Set<string> {
  const visible = new Set<string>([rootId]);
  let frontier = new Set<string>([rootId]);
  const hops = Math.max(1, Math.min(depth, 3));
  for (let d = 0; d < hops; d++) {
    const next = new Set<string>();
    for (const id of frontier) {
      for (const n of neighbours.get(id) ?? []) {
        if (!visible.has(n)) {
          visible.add(n);
          next.add(n);
        }
      }
    }
    frontier = next;
    if (frontier.size === 0) break;
  }
  return visible;
}

/** Cap a focus neighbourhood to the highest-degree neighbours when it would be too large. */
export function cappedNeighbourhood(
  rootId: string,
  neighbours: Map<string, Set<string>>,
  depth: number,
  maxNodes: number,
  rankNodes?: ReadonlyMap<string, Pick<ForceGraphNode, 'degree' | 'errors'>>,
): Set<string> {
  const full = neighbourhoodWithin(rootId, neighbours, depth);
  if (!Number.isFinite(maxNodes) || full.size <= maxNodes) return full;

  const ranked = [...full].filter((id) => id !== rootId);
  ranked.sort((a, b) => {
    const na = rankNodes?.get(a);
    const nb = rankNodes?.get(b);
    const errDiff = (nb?.errors ?? 0) - (na?.errors ?? 0);
    if (errDiff !== 0) return errDiff;
    return (nb?.degree ?? 0) - (na?.degree ?? 0) || a.localeCompare(b);
  });

  const kept = new Set<string>([rootId]);
  for (const id of ranked.slice(0, Math.max(0, maxNodes - 1))) kept.add(id);
  return kept;
}

/** Reduce nodes/links passed to the canvas so hidden items skip simulation + paint. */
export function filterForceGraphData(
  nodes: readonly ForceGraphNode[],
  links: readonly ForceGraphLink[],
  keep: ReadonlySet<string>,
): { nodes: ForceGraphNode[]; links: ForceGraphLink[] } {
  const keptNodes = nodes.filter((n) => keep.has(n.id)).map((n) => ({ ...n }));
  const ids = new Set(keptNodes.map((n) => n.id));
  const keptLinks = links
    .filter((l) => ids.has(l.source) && ids.has(l.target))
    .map((l) => ({ ...l }));
  return { nodes: keptNodes, links: keptLinks };
}

/** Pin every node so d3-force does not reheat on interaction. */
export function pinAllNodes(nodes: ForceGraphNode[]): void {
  for (const n of nodes) {
    if (n.x != null && n.y != null) {
      n.fx = n.x;
      n.fy = n.y;
    }
  }
}

/** Resolve `var(--token)` to a concrete color for canvas rendering. */
export function resolveGraphColor(color: string, readVar: (name: string) => string): string {
  const match = /^var\((--[^)]+)\)$/.exec(color.trim());
  return match ? readVar(match[1]) : color;
}

// ── IG-14: folder-cluster layout (force graph) ───────────────────────────────

export type ClusterCenter = { x: number; y: number };

/** Stable pseudo-random offset from a node id (deterministic, testable). */
export function clusterJitter(id: string, spread: number): { dx: number; dy: number } {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
  }
  const a = ((h & 0xffff) / 0xffff) - 0.5;
  const b = (((h >> 16) & 0xffff) / 0xffff) - 0.5;
  return { dx: a * spread * 2, dy: b * spread * 2 };
}

/** Top-level folder bucket used for lane placement. */
export function clusterKey(node: Pick<ForceGraphNode, 'folder' | 'external'>): string {
  return node.external ? 'external' : node.folder;
}

/**
 * Place cluster anchor points on a grid so modules (application, system, …)
 * start in separate lanes instead of one spaghetti blob.
 */
export function clusterCenters(nodes: readonly ForceGraphNode[]): Map<string, ClusterCenter> {
  const sizes = new Map<string, number>();
  for (const n of nodes) {
    const key = clusterKey(n);
    sizes.set(key, (sizes.get(key) ?? 0) + 1);
  }

  const keys = [...sizes.keys()].sort((a, b) => {
    if (a === 'external') return 1;
    if (b === 'external') return -1;
    const diff = (sizes.get(b) ?? 0) - (sizes.get(a) ?? 0);
    return diff !== 0 ? diff : a.localeCompare(b);
  });

  const count = keys.length;
  const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
  const rows = Math.ceil(count / cols);
  const spacing = count <= 2 ? 260 : count <= 4 ? 220 : 190;
  const centers = new Map<string, ClusterCenter>();

  keys.forEach((key, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    centers.set(key, {
      x: (col - (cols - 1) / 2) * spacing,
      y: (row - (rows - 1) / 2) * spacing,
    });
  });

  return centers;
}

/** Seed node positions and pin folder hubs to their cluster anchor. */
export function applyClusterLayout(
  nodes: ForceGraphNode[],
  centers: Map<string, ClusterCenter>,
): void {
  for (const n of nodes) {
    const c = centers.get(clusterKey(n));
    if (!c) continue;
    const { dx, dy } = clusterJitter(n.id, n.kind === 'folder' ? 8 : 36);
    n.x = c.x + dx;
    n.y = c.y + dy;
    if (n.kind === 'folder') {
      n.fx = c.x;
      n.fy = c.y;
    } else {
      n.fx = undefined;
      n.fy = undefined;
    }
  }
}

export function isCrossClusterLink(
  link: ForceGraphLink,
  nodeById: ReadonlyMap<string, ForceGraphNode>,
): boolean {
  const src = nodeById.get(link.source);
  const tgt = nodeById.get(link.target);
  if (!src || !tgt) return false;
  return clusterKey(src) !== clusterKey(tgt);
}

/** Fuzzy path/name search over visible graph nodes. */
export function searchGraphNodes(
  nodes: readonly ForceGraphNode[],
  query: string,
  limit = 12,
): ForceGraphNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const scored: { node: ForceGraphNode; score: number }[] = [];
  for (const n of nodes) {
    const path = n.kind === 'folder' ? (n.folderPath ?? n.id) : n.id;
    const lower = path.toLowerCase();
    const idx = lower.indexOf(q);
    if (idx === -1) continue;

    const leaf = path.split('/').pop()?.toLowerCase() ?? '';
    let score = 100 - idx;
    if (leaf === q) score += 80;
    else if (leaf.startsWith(q)) score += 40;
    if (n.errors > 0) score += 10;
    if (n.degree > 0) score += Math.min(n.degree, 20);
    scored.push({ node: n, score });
  }

  scored.sort((a, b) => b.score - a.score || a.node.id.localeCompare(b.node.id));
  return scored.slice(0, limit).map((s) => s.node);
}
