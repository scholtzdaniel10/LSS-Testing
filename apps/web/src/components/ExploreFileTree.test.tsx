import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ExploreFileTree from './ExploreFileTree';
import { buildFileTree, defaultExpandedFolders } from '../lib/graphModel';

function paths(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `src/f${String(i).padStart(4, '0')}.ts`);
}

describe('ExploreFileTree virtualization', () => {
  it('mounts only a windowed subset of treeitems for a large file set', () => {
    const all = paths(2000);
    const expanded = defaultExpandedFolders(all);
    const nodes = buildFileTree(all, expanded, new Map(), new Map());
    expect(nodes.length).toBeGreaterThan(1000);

    render(
      <ExploreFileTree
        nodes={nodes}
        expandedFolders={expanded}
        selected={null}
        focusPath={null}
        onToggleFolder={() => undefined}
        onOpenFile={() => undefined}
      />,
    );

    const rows = screen.getAllByRole('treeitem');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(80);
    expect(rows.length).toBeLessThan(nodes.length);
  });

  it('keeps expand, badges, and keyboard activation', () => {
    const all = ['src/a.ts', 'src/b.ts', 'lib/c.ts'];
    const expanded = new Set<string>(['src']);
    const errorCount = new Map([['src/a.ts', 1]]);
    const linkCount = new Map([['src/b.ts', 3]]);
    const nodes = buildFileTree(all, expanded, linkCount, errorCount);
    const onToggle = vi.fn();
    const onOpen = vi.fn();

    const { rerender } = render(
      <ExploreFileTree
        nodes={nodes}
        expandedFolders={expanded}
        selected="src/b.ts"
        focusPath="src/a.ts"
        onToggleFolder={onToggle}
        onOpenFile={onOpen}
      />,
    );

    expect(screen.getByText('a.ts')).toBeInTheDocument();
    expect(screen.getAllByText('1 err').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('3 links')).toBeInTheDocument();

    fireEvent.keyDown(screen.getByText('src/').closest('[role="treeitem"]') as HTMLElement, { key: 'Enter' });
    expect(onToggle).toHaveBeenCalledWith('src');

    fireEvent.click(screen.getByText('b.ts').closest('[role="treeitem"]') as HTMLElement);
    expect(onOpen).toHaveBeenCalledWith('src/b.ts');

    const collapsed = buildFileTree(all, new Set(), linkCount, errorCount);
    rerender(
      <ExploreFileTree
        nodes={collapsed}
        expandedFolders={new Set()}
        selected={null}
        focusPath={null}
        onToggleFolder={onToggle}
        onOpenFile={onOpen}
      />,
    );
    expect(screen.queryByText('a.ts')).not.toBeInTheDocument();
    expect(screen.getByText('src/')).toBeInTheDocument();
  });
});
