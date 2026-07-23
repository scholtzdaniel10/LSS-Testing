/**
 * moduleMapModel.ts — DOM module-map layout (no SVG/canvas).
 * Groups files by top-level folder bucket for lightweight Explore views.
 */

import type { GraphEdge } from '../api/client';
import { folderKeyOf } from './radialModel';

export type ModuleFileEntry = {
  path: string;
  name: string;
  links: number;
  errors: number;
};

export type ModuleGroup = {
  key: string;
  label: string;
  files: ModuleFileEntry[];
  fileCount: number;
  errorCount: number;
  totalLinks: number;
};

/** Max files rendered per module column before "show more" drill-in. */
export const MODULE_COLUMN_FILE_CAP = 120;

/** Max total files across all columns in the overview. */
export const MODULE_MAP_FILE_CAP = 400;

function linkCounts(edges: GraphEdge[], fileSet: ReadonlySet<string>): Map<string, number> {
  const map = new Map<string, number>();
  const isExternal = (p: string) => p.startsWith('pkg:') || p.startsWith('php:');
  for (const e of edges) {
    if (isExternal(e.from) || isExternal(e.to)) continue;
    if (!fileSet.has(e.from) || !fileSet.has(e.to)) continue;
    map.set(e.from, (map.get(e.from) ?? 0) + 1);
    map.set(e.to, (map.get(e.to) ?? 0) + 1);
  }
  return map;
}

function errorCountFor(path: string, errorFiles: ReadonlySet<string> | Map<string, number>): number {
  if (errorFiles instanceof Map) return errorFiles.get(path) ?? 0;
  return errorFiles.has(path) ? 1 : 0;
}

/**
 * Build module columns sorted by size. Caps visible files for tile-memory safety.
 */
export function buildModuleGroups(
  files: string[],
  edges: GraphEdge[],
  errorFiles: ReadonlySet<string> | Map<string, number>,
): { modules: ModuleGroup[]; capped: boolean; totalFiles: number } {
  const fileSet = new Set(files);
  const links = linkCounts(edges, fileSet);
  const byKey = new Map<string, ModuleFileEntry[]>();

  for (const path of files) {
    const key = folderKeyOf(path);
    const entry: ModuleFileEntry = {
      path,
      name: path.split('/').pop() ?? path,
      links: links.get(path) ?? 0,
      errors: errorCountFor(path, errorFiles),
    };
    const arr = byKey.get(key) ?? [];
    arr.push(entry);
    byKey.set(key, arr);
  }

  let capped = false;
  let budget = MODULE_MAP_FILE_CAP;

  const modules: ModuleGroup[] = [...byKey.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([key, entries]) => {
      const sorted = [...entries].sort(
        (a, b) => (b.errors - a.errors) || (b.links - a.links) || a.path.localeCompare(b.path),
      );
      let visible = sorted;
      if (sorted.length > MODULE_COLUMN_FILE_CAP) {
        visible = sorted.slice(0, MODULE_COLUMN_FILE_CAP);
        capped = true;
      }
      if (visible.length > budget) {
        visible = visible.slice(0, budget);
        capped = true;
      }
      budget -= visible.length;

      const errorCount = sorted.reduce((n, f) => n + f.errors, 0);
      const totalLinks = sorted.reduce((n, f) => n + f.links, 0);
      return {
        key,
        label: key === 'other' ? 'other' : `${key}/`,
        files: visible,
        fileCount: sorted.length,
        errorCount,
        totalLinks,
      };
    });

  return { modules, capped, totalFiles: files.length };
}

/** Direct neighbours of a file (undirected). */
export function neighbourPaths(path: string, edges: GraphEdge[]): string[] {
  const isExternal = (p: string) => p.startsWith('pkg:') || p.startsWith('php:');
  const set = new Set<string>();
  for (const e of edges) {
    if (isExternal(e.from) || isExternal(e.to)) continue;
    if (e.from === path) set.add(e.to);
    else if (e.to === path) set.add(e.from);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}
