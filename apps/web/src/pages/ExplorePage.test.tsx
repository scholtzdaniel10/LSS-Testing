import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { GraphRollup } from '../api/client';

const { ensureMapRollup, ensureExploreData, ensureTree, graph, graphOverview } = vi.hoisted(() => ({
  ensureMapRollup: vi.fn(async () => undefined),
  ensureExploreData: vi.fn(async () => undefined),
  ensureTree: vi.fn(async () => undefined),
  graph: vi.fn(),
  graphOverview: vi.fn(),
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

vi.mock('../state/ProjectContext', () => ({
  useProject: () => ({
    tree: [],
    graphEdges: [],
    graphRollup,
    rollupStatus,
    rollupError,
    rollupMeta,
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
    },
  };
});

vi.mock('../components/DependencyGraph', () => ({
  default: () => <div data-testid="dependency-graph">graph canvas</div>,
}));

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
    graph.mockClear();
    graphOverview.mockClear();
    rollupStatus = 'ready';
    rollupError = null;
    graphRollup = twoFolderRollup;
    rollupMeta = {};
  });

  it('calls ensureMapRollup and never api.graph / api.graphOverview / ensureExploreData', async () => {
    renderExplore();

    await waitFor(() => {
      expect(ensureMapRollup).toHaveBeenCalled();
    });
    expect(ensureExploreData).not.toHaveBeenCalled();
    expect(graph).not.toHaveBeenCalled();
    expect(graphOverview).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.getByRole('img', { name: 'Codebase folder map' })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /Folder: app\// })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Folder: lib\// })).toBeInTheDocument();
    expect(screen.queryByText('.php')).not.toBeInTheDocument();
  });

  it('does not fetch GET /graph when a hub is clicked (highlight only)', async () => {
    renderExplore();
    const hub = await screen.findByRole('button', { name: /Folder: app\// });
    fireEvent.click(hub);
    expect(ensureExploreData).not.toHaveBeenCalled();
    expect(graph).not.toHaveBeenCalled();
    expect(graphOverview).not.toHaveBeenCalled();
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
