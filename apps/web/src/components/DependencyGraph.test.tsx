import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { COMPUTING_HINT } from './ScreenState';

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

vi.mock('../lib/useModelWorker', () => ({
  useGraphView: () => ({
    status: 'computing',
    data: {
      nodes: [
        {
          id: 'app/A.php',
          name: 'A.php',
          kind: 'file',
          folder: 'app',
          external: false,
          errors: 0,
          inDegree: 0,
          degree: 1,
          fileCount: 1,
          color: 'var(--series-1)',
        },
      ],
      links: [],
      folderCount: 1,
      fileNodeCount: 1,
      hiddenExternal: 0,
    },
    error: null,
  }),
}));

vi.mock('react-force-graph-2d', () => ({
  default: () => <canvas data-testid="force-graph-canvas" />,
}));

import DependencyGraph from './DependencyGraph';

describe('DependencyGraph worker computing', () => {
  it('keeps the last graph frame mounted and shows Laying out, not a skeleton', () => {
    render(
      <DependencyGraph
        snapshotId="p1:t1"
        edges={[]}
        errorFiles={new Map()}
        files={['app/A.php']}
        selected={null}
        onSelect={() => undefined}
        onOpenFile={() => undefined}
      />,
    );

    expect(document.querySelector('.skeleton-block')).toBeNull();
    expect(screen.getByText(COMPUTING_HINT)).toBeInTheDocument();
    expect(screen.getByTestId('force-graph-canvas')).toBeInTheDocument();
    expect(screen.getByText(/1 files/)).toBeInTheDocument();
  });
});
