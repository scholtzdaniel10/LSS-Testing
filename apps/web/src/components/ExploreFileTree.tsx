import { useEffect } from 'react';
import type { TreeNode } from '../lib/graphModel';
import { useWindowedList } from '../lib/useWindowedList';

/** Matches `--tree-row-h` in tokens.css — virtualizer needs a px number. */
export const TREE_ROW_H = 24;

const SERIES: Record<string, string> = {
  app: 'var(--series-1)',
  application: 'var(--series-1)',
  routes: 'var(--series-2)',
  resources: 'var(--series-3)',
  database: 'var(--series-4)',
  src: 'var(--series-1)',
  system: 'var(--series-2)',
  other: 'var(--series-other)',
};

export type ExploreFileTreeProps = {
  nodes: TreeNode[];
  expandedFolders: ReadonlySet<string>;
  selected: string | null;
  focusPath: string | null;
  onToggleFolder: (folderPath: string) => void;
  onOpenFile: (path: string) => void;
};

export function ExploreFileTree({
  nodes,
  expandedFolders,
  selected,
  focusPath,
  onToggleFolder,
  onOpenFile,
}: ExploreFileTreeProps) {
  const { parentRef, start, end, scrollToIndex, totalHeight } = useWindowedList(nodes.length, TREE_ROW_H);

  useEffect(() => {
    if (!focusPath) return;
    const index = nodes.findIndex((node) => node.kind === 'file' && node.path === focusPath);
    if (index >= 0) scrollToIndex(index);
  }, [focusPath, nodes, scrollToIndex]);

  const visible = nodes.slice(start, end);

  return (
    <div className="tree" role="tree" ref={parentRef}>
      <div className="tree__spacer" style={{ height: totalHeight }}>
        {visible.map((node, offset) => {
          const index = start + offset;
          const isFocused = node.kind === 'file' && node.path === focusPath;
          const isSelected = node.kind === 'file' && node.path === selected;
          const isExpanded = node.kind === 'folder' && expandedFolders.has(node.path);

          return (
            <div
              key={node.path}
              className={`tree__row${isSelected ? ' tree__row--selected' : ''}${node.kind === 'folder' ? ' tree__row--folder' : ''}`}
              style={{
                top: index * TREE_ROW_H,
                paddingLeft: `calc(var(--sp-2) + ${node.depth} * var(--sp-3))`,
              }}
              role="treeitem"
              aria-expanded={node.kind === 'folder' ? isExpanded : undefined}
              aria-selected={isSelected || isFocused || undefined}
              tabIndex={0}
              onClick={() => {
                if (node.kind === 'folder') onToggleFolder(node.path);
                else onOpenFile(node.path);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  if (node.kind === 'folder') onToggleFolder(node.path);
                  else onOpenFile(node.path);
                }
              }}
            >
              {node.kind === 'folder' ? (
                <span className="tree__chevron" aria-hidden="true">
                  {isExpanded ? '▾' : '▸'}
                </span>
              ) : (
                <span
                  className="tree__dot"
                  style={{ background: SERIES[node.folder] ?? SERIES.other }}
                  aria-hidden="true"
                />
              )}
              <span title={node.path} style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {node.name}
                {node.kind === 'folder' ? '/' : ''}
              </span>
              {node.errors > 0 && (
                <span className="tree__badge tree__badge--err" aria-label={`${node.errors} error${node.errors !== 1 ? 's' : ''}`}>
                  {node.errors} err
                </span>
              )}
              {node.kind === 'file' && node.links > 0 && (
                <span className="tree__badge">{node.links} links</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default ExploreFileTree;
