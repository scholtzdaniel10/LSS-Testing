/**
 * radialModel.ts — Pure logic for the hierarchical edge-bundling radial view.
 *
 * Responsibilities:
 *  - Connected-component decomposition (undirected)
 *  - Per-component hierarchy from file paths
 *  - Edge-health classification (red if either endpoint has error-severity finding)
 *  - Focus-neighbourhood computation (both directions)
 */

import type { GraphEdge } from '../api/client';

// ── Types ────────────────────────────────────────────────────────────────────

/** A node in a component's radial hierarchy. */
export type RadialNode = {
  /** Slash-delimited path (file) or directory prefix (inner node). */
  id: string;
  /** Basename for display. */
  name: string;
  /** 'file' = leaf; 'dir' = synthesised internal directory node. */
  kind: 'file' | 'dir';
  children: RadialNode[];
};

/** An edge with its health classification. */
export type RadialEdge = {
  from: string; // file path
  to: string;   // file path
  /** true  = at least one endpoint has an error-severity diagnostic */
  broken: boolean;
};

/** One connected component ready for radial layout. */
export type RadialComponent = {
  /** Unique index within the full layout. */
  index: number;
  /** All file paths in this component (leaves of the hierarchy). */
  files: string[];
  /** Hierarchical root for d3-cluster / manual radial layout. */
  root: RadialNode;
  /** Edges that connect files within this component. */
  edges: RadialEdge[];
};

/** The single "unlinked" group: files with no edges at all. */
export type UnlinkedGroup = {
  files: string[];
};

export type RadialLayout = {
  components: RadialComponent[]; // largest first
  unlinked: UnlinkedGroup;
};

// ── Connected Components ─────────────────────────────────────────────────────

/**
 * Union-Find (path-compressed, rank-unioned) for component detection.
 */
class UnionFind {
  private parent: Map<string, string> = new Map();
  private rank: Map<string, number> = new Map();

  private find(x: string): string {
    if (!this.parent.has(x)) {
      this.parent.set(x, x);
      this.rank.set(x, 0);
    }
    const p = this.parent.get(x)!;
    if (p !== x) {
      this.parent.set(x, this.find(p)); // path compression
    }
    return this.parent.get(x)!;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    const rankA = this.rank.get(ra) ?? 0;
    const rankB = this.rank.get(rb) ?? 0;
    if (rankA < rankB) {
      this.parent.set(ra, rb);
    } else if (rankA > rankB) {
      this.parent.set(rb, ra);
    } else {
      this.parent.set(rb, ra);
      this.rank.set(ra, rankA + 1);
    }
  }

  /** Group all registered ids by their root representative. */
  groups(allIds: string[]): Map<string, string[]> {
    // Ensure every id is registered.
    for (const id of allIds) this.find(id);
    const map = new Map<string, string[]>();
    for (const id of allIds) {
      const root = this.find(id);
      const arr = map.get(root) ?? [];
      arr.push(id);
      map.set(root, arr);
    }
    return map;
  }
}

// ── Hierarchy builder ────────────────────────────────────────────────────────

/**
 * Build a tree of RadialNodes from a list of file paths.
 * Path segments become inner 'dir' nodes; the final segment is a 'file' node.
 *
 * A synthetic root with id='' and name='root' wraps everything.
 */
export function buildHierarchy(files: string[]): RadialNode {
  const root: RadialNode = { id: '', name: 'root', kind: 'dir', children: [] };
  const dirMap = new Map<string, RadialNode>();
  dirMap.set('', root);

  const ensureDir = (path: string): RadialNode => {
    if (dirMap.has(path)) return dirMap.get(path)!;
    const parts = path.split('/');
    const name = parts[parts.length - 1] ?? path;
    const parentPath = parts.slice(0, -1).join('/');
    const parent = ensureDir(parentPath);
    const node: RadialNode = { id: path, name, kind: 'dir', children: [] };
    dirMap.set(path, node);
    parent.children.push(node);
    return node;
  };

  // Sort files for deterministic ordering.
  const sorted = [...files].sort((a, b) => a.localeCompare(b));

  for (const file of sorted) {
    const parts = file.split('/');
    const name = parts[parts.length - 1] ?? file;
    const dirPath = parts.slice(0, -1).join('/');
    const parent = dirPath === '' ? root : ensureDir(dirPath);
    const fileNode: RadialNode = { id: file, kind: 'file', name, children: [] };
    parent.children.push(fileNode);
  }

  return root;
}

// ── Edge classification ──────────────────────────────────────────────────────

/**
 * Classify an edge as broken if EITHER endpoint has at least one error-severity
 * diagnostic finding. Warnings do NOT make an edge broken (v0 rule).
 *
 * @param edges   Raw graph edges.
 * @param errorFiles Set of file paths that have at least one error-severity finding.
 */
export function classifyEdges(
  edges: GraphEdge[],
  errorFiles: ReadonlySet<string>,
): RadialEdge[] {
  return edges.map((e) => ({
    from: e.from,
    to: e.to,
    broken: errorFiles.has(e.from) || errorFiles.has(e.to),
  }));
}

// ── Focus neighbourhood ──────────────────────────────────────────────────────

export type FocusNeighbourhood = {
  /** The focused file itself. */
  focus: string;
  /** Files directly connected to focus (both in-edges and out-edges). */
  neighbours: Set<string>;
  /** All edges that touch the focus node (subset of the component's edges). */
  edges: RadialEdge[];
};

/**
 * Compute the direct neighbourhood of `focusFile` within `edges`.
 * Both incoming and outgoing edges are included.
 */
export function computeFocusNeighbourhood(
  focusFile: string,
  edges: RadialEdge[],
): FocusNeighbourhood {
  const neighbours = new Set<string>();
  const relevant: RadialEdge[] = [];
  for (const e of edges) {
    if (e.from === focusFile) {
      neighbours.add(e.to);
      relevant.push(e);
    } else if (e.to === focusFile) {
      neighbours.add(e.from);
      relevant.push(e);
    }
  }
  return { focus: focusFile, neighbours, edges: relevant };
}

// ── Main layout builder ──────────────────────────────────────────────────────

/**
 * Given all files in the project, the raw dependency graph, and the set of files
 * with error-severity diagnostics, produce a RadialLayout.
 *
 * @param allFiles    All file paths (from api.tree). May include files not in any edge.
 * @param edges       Raw edges from api.graph. Pass [] or call with null -> handle null
 *                    in callers by passing [].
 * @param errorFiles  Set of file paths with at least one error-severity diagnostic.
 */
export function buildRadialLayout(
  allFiles: string[],
  edges: GraphEdge[],
  errorFiles: ReadonlySet<string>,
): RadialLayout {
  if (allFiles.length === 0) {
    return { components: [], unlinked: { files: [] } };
  }

  // 1. Filter edges to internal file paths only (drop pkg:/php: externals).
  const isExternal = (p: string) => p.startsWith('pkg:') || p.startsWith('php:');
  const internalEdges = edges.filter((e) => !isExternal(e.from) && !isExternal(e.to));

  // 2. Build a set of all files that appear in any edge (for deduplication).
  const allFileSet = new Set(allFiles);
  const internalEdgesFiltered = internalEdges.filter(
    (e) => allFileSet.has(e.from) && allFileSet.has(e.to),
  );

  // 3. Find files that have at least one edge.
  const linkedFiles = new Set<string>();
  for (const e of internalEdgesFiltered) {
    linkedFiles.add(e.from);
    linkedFiles.add(e.to);
  }

  const unlinkedFiles = allFiles.filter((f) => !linkedFiles.has(f));

  // 4. Connected components (undirected) over linked files.
  const uf = new UnionFind();
  for (const e of internalEdgesFiltered) {
    uf.union(e.from, e.to);
  }

  const linkedFileList = [...linkedFiles];
  const componentGroups = uf.groups(linkedFileList);

  // 5. Build classified edges.
  const classifiedEdges = classifyEdges(internalEdgesFiltered, errorFiles);

  // 6. Build edge lookup per component representative.
  //    We need to map file->component; find via a temp lookup.
  const fileToRep = new Map<string, string>();
  for (const [rep, files] of componentGroups) {
    for (const f of files) {
      fileToRep.set(f, rep);
    }
  }

  const edgesPerComponent = new Map<string, RadialEdge[]>();
  for (const e of classifiedEdges) {
    const rep = fileToRep.get(e.from);
    if (rep === undefined) continue;
    const arr = edgesPerComponent.get(rep) ?? [];
    arr.push(e);
    edgesPerComponent.set(rep, arr);
  }

  // 7. Assemble components, largest first.
  let idx = 0;
  const components: RadialComponent[] = [...componentGroups.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([rep, files]) => {
      const component: RadialComponent = {
        index: idx++,
        files,
        root: buildHierarchy(files),
        edges: edgesPerComponent.get(rep) ?? [],
      };
      return component;
    });

  return {
    components,
    unlinked: { files: unlinkedFiles.sort((a, b) => a.localeCompare(b)) },
  };
}

// ── Leaf list helpers ────────────────────────────────────────────────────────

/** Collect all leaf (file) nodes from a hierarchy in DFS order. */
export function collectLeaves(root: RadialNode): RadialNode[] {
  const leaves: RadialNode[] = [];
  const visit = (node: RadialNode) => {
    if (node.kind === 'file') {
      leaves.push(node);
    } else {
      for (const child of node.children) visit(child);
    }
  };
  visit(root);
  return leaves;
}

// ── Radius scaling ───────────────────────────────────────────────────────────

/**
 * Minimum arc length per member (px). The circle circumference must be at
 * least memberCount x MIN_ARC_PX so labels/dots don't crowd together.
 */
export const MIN_ARC_PX = 16;

/** Absolute minimum radius even for 1-file components (px). */
export const MIN_RADIUS_PX = 60;

/** Absolute maximum radius cap (px). */
export const MAX_RADIUS_PX = 320;

/**
 * Compute the display radius for a component circle based on member count.
 *
 * Formula: r = max(MIN_RADIUS, ceil(memberCount * MIN_ARC_PX / (2*pi))),
 * clamped to MAX_RADIUS.
 *
 * @param memberCount Number of file nodes in the component.
 */
export function componentRadius(memberCount: number): number {
  if (memberCount <= 0) return MIN_RADIUS_PX;
  const fromArc = Math.ceil((memberCount * MIN_ARC_PX) / (2 * Math.PI));
  return Math.min(MAX_RADIUS_PX, Math.max(MIN_RADIUS_PX, fromArc));
}

// ── Label declutter ──────────────────────────────────────────────────────────

/**
 * Components with more than this many members render dots only; permanent
 * labels are suppressed to prevent overlapping rings.
 */
export const LABEL_THRESHOLD = 40;

/**
 * Return true when a node should show its permanent (always-visible) label.
 *
 * Rules:
 *  - If memberCount <= LABEL_THRESHOLD: always show label.
 *  - Otherwise: only show label when the node is focused or is a direct
 *    neighbour of the focused/hovered node.
 *
 * @param memberCount    Total members in the component.
 * @param path           File path of this node.
 * @param focusFile      Currently focused file, or null.
 * @param activeNeighbours Set of paths that are direct neighbours of the
 *                         focused or hovered file.
 */
export function shouldShowLabel(
  memberCount: number,
  path: string,
  focusFile: string | null,
  activeNeighbours: ReadonlySet<string>,
): boolean {
  if (memberCount <= LABEL_THRESHOLD) return true;
  if (path === focusFile) return true;
  if (activeNeighbours.has(path)) return true;
  return false;
}
