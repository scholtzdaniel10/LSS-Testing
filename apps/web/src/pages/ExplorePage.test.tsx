import React from 'react';
import { createMemoryHistory } from 'history';
import { MemoryRouter, Router } from 'react-router-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { GraphOverview, GraphRollup, TreeFile } from '../api/client';

const {
  ensureMapRollup,
  ensureExploreData,
  ensureTree,
  ensureMapNeighbourhood,
  clearMapNeighbourhood,
  graph,
  graphOverview,
  graphNeighbourhood,
  openInIde,
} = vi.hoisted(() => ({
  ensureMapRollup: vi.fn(async () => undefined),
  ensureExploreData: vi.fn(async () => undefined),
  ensureTree: vi.fn(async () => undefined),
  ensureMapNeighbourhood: vi.fn(async () => undefined),
  clearMapNeighbourhood: vi.fn(),
  graph: vi.fn(),
  graphOverview: vi.fn(),
  graphNeighbourhood: vi.fn(),
  openInIde: vi.fn(() => true),
}));

const twoFolderRollup: GraphRollup = {
  projectId: 'p-1',
  scannedAt: null,
  nodes: [
    {
      id: 'dir:app',
      name: 'app/',
      kind: 'folder',
      folder: 'app',
      folderPath: 'app',
      fileCount: 2,
      errors: 0,
      degree: 2,
      inDegree: 0,
      external: false,
    },
    {
      id: 'dir:lib',
      name: 'lib/',
      kind: 'folder',
      folder: 'other',
      folderPath: 'lib',
      fileCount: 2,
      errors: 0,
      degree: 2,
      inDegree: 2,
      external: false,
    },
  ],
  links: [{ source: 'dir:app', target: 'dir:lib', weight: 2, externalTarget: false }],
};

let rollupStatus: 'idle' | 'loading' | 'ready' | 'empty' | 'error' = 'ready';
let rollupError: string | null = null;
let graphRollup: GraphRollup | null = twoFolderRollup;
let rollupMeta: { reason?: string } = {};
let neighbourhoodStatus: 'idle' | 'loading' | 'ready' | 'empty' | 'error' = 'idle';
let neighbourhoodError: string | null = null;
let graphNeighbourhoodData: GraphOverview | null = null;
let neighbourhoodMeta: { reason?: string } = {};
let neighbourhoodFocus: string | null = null;
let treeFiles: TreeFile[] = [];

const appNeighbourhood: GraphOverview = {
  projectId: 'p-1',
  scannedAt: null,
  nodes: [
    {
      id: 'app/A.php',
      name: 'A.php',
      kind: 'file',
      folder: 'app',
      fileCount: 1,
      errors: 0,
      degree: 1,
      inDegree: 0,
      external: false,
    },
    {
      id: 'lib/C.php',
      name: 'C.php',
      kind: 'file',
      folder: 'other',
      fileCount: 1,
      errors: 0,
      degree: 1,
      inDegree: 1,
      external: false,
    },
  ],
  links: [{ source: 'app/A.php', target: 'lib/C.php', weight: 1, externalTarget: false }],
};

vi.mock('../state/ProjectContext', () => ({
  useProject: () => ({
    tree: treeFiles,
    graphEdges: [],
    graphRollup,
    rollupStatus,
    rollupError,
    rollupMeta,
    graphNeighbourhood: graphNeighbourhoodData,
    neighbourhoodStatus,
    neighbourhoodError,
    neighbourhoodMeta,
    neighbourhoodFocus,
    errors: [],
    localManifest: null,
    status: 'ready',
    errorMessage: null,
    usage: null,
    project: {
      id: 'p-1',
      name: 'Demo',
      sandboxPath: null,
      lastImportedAt: '2026-01-01',
      createdAt: null,
      updatedAt: null,
    },
    ensureExploreData,
    ensureTree,
    ensureMapRollup,
    ensureMapNeighbourhood,
    clearMapNeighbourhood,
  }),
}));

vi.mock('../api/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('../api/client')>();
  return {
    ...original,
    api: {
      ...original.api,
      graph,
      graphOverview,
      graphNeighbourhood,
    },
  };
});

vi.mock('../components/DependencyGraph', () => ({
  default: () => <div data-testid="dependency-graph">graph canvas</div>,
}));

vi.mock('../types', async (importOriginal) => {
  const original = await importOriginal<typeof import('../types')>();
  return { ...original, openInIde };
});

import ExplorePage from './ExplorePage';

function renderExplore() {
  return render(
    <MemoryRouter initialEntries={['/explore']}>
      <ExplorePage />
    </MemoryRouter>,
  );
}

describe('Explore Map first-paint (IG-32)', () => {
  beforeEach(() => {
    ensureMapRollup.mockClear();
    ensureExploreData.mockClear();
    ensureTree.mockClear();
    ensureMapNeighbourhood.mockClear();
    clearMapNeighbourhood.mockClear();
    graph.mockClear();
    graphOverview.mockClear();
    graphNeighbourhood.mockClear();
    openInIde.mockClear();
    treeFiles = [];
    rollupStatus = 'ready';
    rollupError = null;
    graphRollup = twoFolderRollup;
    rollupMeta = {};
    neighbourhoodStatus = 'idle';
    neighbourhoodError = null;
    graphNeighbourhoodData = null;
    neighbourhoodMeta = {};
    neighbourhoodFocus = null;
  });

  it('calls ensureMapRollup and never api.graph / api.graphOverview / ensureExploreData', async () => {
    renderExplore();

    await waitFor(() => {
      expect(ensureMapRollup).toHaveBeenCalled();
    });
    expect(ensureExploreData).not.toHaveBeenCalled();
    expect(graph).not.toHaveBeenCalled();
    expect(graphOverview).not.toHaveBeenCalled();
    expect(ensureMapNeighbourhood).not.toHaveBeenCalled();
    expect(graphNeighbourhood).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.getByRole('img', { name: 'Codebase folder map' })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /Folder: app\// })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Folder: lib\// })).toBeInTheDocument();
    expect(screen.queryByText('.php')).not.toBeInTheDocument();
  });

  it('fetches neighbourhood on hub click, not GET /graph', async () => {
    renderExplore();
    const hub = await screen.findByRole('button', { name: /Folder: app\// });
    fireEvent.click(hub);
    expect(ensureMapNeighbourhood).toHaveBeenCalledWith('dir:app');
    expect(ensureExploreData).not.toHaveBeenCalled();
    expect(graph).not.toHaveBeenCalled();
    expect(graphOverview).not.toHaveBeenCalled();
    expect(graphNeighbourhood).not.toHaveBeenCalled();
  });

  it('lazy-loads GET /graph only after the user opens Graph', async () => {
    renderExplore();
    await waitFor(() => {
      expect(ensureMapRollup).toHaveBeenCalled();
    });
    expect(ensureExploreData).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Graph' }));

    await waitFor(() => {
      expect(ensureExploreData).toHaveBeenCalled();
    });
    expect(graph).not.toHaveBeenCalled();
    expect(graphOverview).not.toHaveBeenCalled();
  });
});

describe('Explore Map screen states (note 09)', () => {
  beforeEach(() => {
    ensureMapRollup.mockClear();
    ensureExploreData.mockClear();
    ensureTree.mockClear();
    ensureMapNeighbourhood.mockClear();
    clearMapNeighbourhood.mockClear();
    openInIde.mockClear();
    treeFiles = [];
    rollupStatus = 'ready';
    rollupError = null;
    graphRollup = twoFolderRollup;
    rollupMeta = {};
    neighbourhoodStatus = 'idle';
    neighbourhoodError = null;
    graphNeighbourhoodData = null;
    neighbourhoodMeta = {};
    neighbourhoodFocus = null;
  });

  it('shows loading while rollup is in flight', () => {
    rollupStatus = 'loading';
    graphRollup = null;
    renderExplore();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('shows empty for data=null / no-graph-yet', () => {
    rollupStatus = 'empty';
    graphRollup = null;
    rollupMeta = { reason: 'no-graph-yet' };
    renderExplore();
    expect(screen.getByText('Nothing here yet')).toBeInTheDocument();
    expect(screen.getByText(/No snapshot yet/)).toBeInTheDocument();
    expect(ensureExploreData).not.toHaveBeenCalled();
  });

  it('shows empty for zero folder nodes', () => {
    rollupStatus = 'empty';
    graphRollup = { projectId: 'p-1', scannedAt: null, nodes: [], links: [] };
    rollupMeta = {};
    renderExplore();
    expect(screen.getByText('Nothing here yet')).toBeInTheDocument();
    expect(screen.getByText(/No folders in the rollup/)).toBeInTheDocument();
  });

  it('shows error when the rollup request fails', () => {
    rollupStatus = 'error';
    rollupError = 'Failed to load map rollup';
    graphRollup = null;
    renderExplore();
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to load map rollup');
    expect(ensureExploreData).not.toHaveBeenCalled();
  });
});

describe('Explore Map drill screen states (note 09)', () => {
  beforeEach(() => {
    ensureMapRollup.mockClear();
    ensureExploreData.mockClear();
    ensureTree.mockClear();
    ensureMapNeighbourhood.mockClear();
    clearMapNeighbourhood.mockClear();
    graph.mockClear();
    graphOverview.mockClear();
    graphNeighbourhood.mockClear();
    openInIde.mockClear();
    treeFiles = [];
    rollupStatus = 'ready';
    rollupError = null;
    graphRollup = twoFolderRollup;
    rollupMeta = {};
    neighbourhoodError = null;
    neighbourhoodMeta = {};
    neighbourhoodFocus = 'dir:app';
  });

  it('keeps the rollup canvas and shows loading while neighbourhood is in flight', async () => {
    neighbourhoodStatus = 'loading';
    graphNeighbourhoodData = null;
    renderExplore();
    expect(await screen.findByRole('img', { name: 'Codebase folder map' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Folder: app\// })).toBeInTheDocument();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to folders' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/File: /)).not.toBeInTheDocument();
    expect(ensureExploreData).not.toHaveBeenCalled();
    expect(graph).not.toHaveBeenCalled();
  });

  it('shows empty for a folder with no neighbourhood files', () => {
    neighbourhoodStatus = 'empty';
    graphNeighbourhoodData = { projectId: 'p-1', scannedAt: null, nodes: [], links: [] };
    renderExplore();
    expect(screen.getByText('Nothing here yet')).toBeInTheDocument();
    expect(screen.getByText(/No neighbourhood for this folder/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to folders' })).toBeInTheDocument();
    expect(ensureExploreData).not.toHaveBeenCalled();
  });

  it('shows error when the neighbourhood request fails', () => {
    neighbourhoodStatus = 'error';
    neighbourhoodError = 'Failed to load neighbourhood';
    graphNeighbourhoodData = null;
    renderExplore();
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to load neighbourhood');
    expect(screen.getByRole('button', { name: 'Back to folders' })).toBeInTheDocument();
    expect(ensureExploreData).not.toHaveBeenCalled();
  });

  it('expands files on the same canvas when neighbourhood is ready', async () => {
    neighbourhoodStatus = 'ready';
    graphNeighbourhoodData = appNeighbourhood;
    renderExplore();
    expect(await screen.findByRole('img', { name: 'Codebase folder map' })).toBeInTheDocument();
    expect(screen.getByLabelText(/File: app\/A\.php/)).toBeInTheDocument();
    expect(screen.getByLabelText(/File: lib\/C\.php/)).toBeInTheDocument();
    expect(screen.getByText('A.php')).toBeInTheDocument();
    expect(screen.getByText('C.php')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to folders' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Folder: lib\// })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to folders' }));
    expect(clearMapNeighbourhood).toHaveBeenCalled();
    expect(ensureExploreData).not.toHaveBeenCalled();
    expect(graph).not.toHaveBeenCalled();
  });

  it('file click sets ?focus=, selects the tree row, opens the IDE, and skips GET /graph', async () => {
    neighbourhoodStatus = 'ready';
    graphNeighbourhoodData = appNeighbourhood;
    treeFiles = [
      { path: 'app/A.php', size: 1, lang: 'php' },
      { path: 'lib/C.php', size: 1, lang: 'php' },
    ];
    const history = createMemoryHistory({ initialEntries: ['/explore'] });
    render(
      <Router history={history}>
        <ExplorePage />
      </Router>,
    );

    fireEvent.click(await screen.findByRole('button', { name: /File: app\/A\.php/ }));

    expect(history.location.search).toBe('?focus=app%2FA.php');
    expect(openInIde).toHaveBeenCalledWith(expect.anything(), 'app/A.php', 1, 'Demo');
    expect(screen.getByRole('treeitem', { name: /A\.php/ })).toHaveAttribute('aria-selected', 'true');
    expect(ensureExploreData).not.toHaveBeenCalled();
    expect(graph).not.toHaveBeenCalled();
    expect(graphOverview).not.toHaveBeenCalled();
  });
});
