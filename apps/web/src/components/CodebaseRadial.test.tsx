import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LOADING_HINT } from './ScreenState';
import type { GraphEdge } from '../api/client';

const files = ['app/A.php', 'lib/C.php'];
const edges: GraphEdge[] = [{ from: 'app/A.php', to: 'lib/C.php', kind: 'import' }];

vi.mock('../lib/useModelWorker', () => ({
  useRadialLayout: () => ({
    status: 'loading',
    data: { components: [], unlinked: { files: [] } },
    error: null,
  }),
}));

import CodebaseRadial from './CodebaseRadial';

describe('CodebaseRadial worker loading', () => {
  it('keeps the SVG canvas mounted and shows loading, not a skeleton', () => {
    render(
      <CodebaseRadial
        snapshotId="p1:t1"
        edges={edges}
        findings={[]}
        files={files.map((path) => ({ path, size: 0, lang: 'php' }))}
        focusParam={null}
        onFocusTree={() => undefined}
      />,
    );

    expect(document.querySelector('.skeleton-block')).toBeNull();
    expect(screen.getByText(LOADING_HINT)).toBeInTheDocument();
    expect(document.querySelector('svg')).not.toBeNull();
    expect(screen.queryByText('No linked files to display.')).not.toBeInTheDocument();
  });
});
