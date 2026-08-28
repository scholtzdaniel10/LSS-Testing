import React, { useEffect } from 'react';
import { render, waitFor, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { GraphRollup, Project } from '../api/client';

const demoProject: Project = {
  id: 'p-1',
  name: 'Demo',
  sandboxPath: null,
  lastImportedAt: '2026-01-01',
  createdAt: null,
  updatedAt: null,
};

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

const envelope = <T,>(data: T, meta: Record<string, unknown> = {}) => ({
  data,
  meta,
  errors: [] as [],
});

vi.mock('../api/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('../api/client')>();
  return {
    ...original,
    getApiToken: () => 'test-token',
    getActiveProjectId: () => 'p-1',
    setApiToken: vi.fn(),
    setActiveProjectId: vi.fn(),
    api: {
      ...original.api,
      projects: vi.fn(async () => envelope([demoProject])),
      bootstrap: vi.fn(async () =>
        envelope({ project: demoProject, health: null, usage: null, analysers: {} }),
      ),
      healthHistory: vi.fn(async () => envelope([])),
      errors: vi.fn(async () => ({ ...envelope([]), analysers: {}, chains: [] })),
      targetEnvs: vi.fn(async () => envelope([])),
      graph: vi.fn(async () => envelope({ projectId: 'p-1', scannedAt: '2026-01-01', edges: [] })),
      graphOverview: vi.fn(async () => envelope(null)),
      graphRollup: vi.fn(async () => envelope(twoFolderRollup)),
      graphNeighbourhood: vi.fn(async () => envelope(null)),
      tree: vi.fn(async () => envelope([])),
    },
  };
});

vi.mock('../lib/localProjectStore', () => ({
  listLocalProjects: vi.fn(async () => []),
  deleteLocalProjectsForServerId: vi.fn(async () => undefined),
}));

import { api } from '../api/client';
import { ProjectProvider, useProject } from './ProjectContext';

function MapFirstPaintProbe() {
  const { ensureMapRollup, rollupStatus, graphRollup, status } = useProject();
  useEffect(() => {
    if (status === 'ready') void ensureMapRollup();
  }, [ensureMapRollup, status]);
  return (
    <div>
      <span data-testid="rollup-status">{rollupStatus}</span>
      <span data-testid="hub-ids">{graphRollup?.nodes.filter((n) => n.kind === 'folder').map((n) => n.id).join(',')}</span>
    </div>
  );
}

describe('ensureMapRollup first-paint path', () => {
  beforeEach(() => {
    vi.mocked(api.graph).mockClear();
    vi.mocked(api.graphOverview).mockClear();
    vi.mocked(api.graphRollup).mockClear();
    vi.mocked(api.graphNeighbourhood).mockClear();
    vi.mocked(api.tree).mockClear();
  });

  it('fetches graphRollup(id, 1) and never calls api.graph or api.graphOverview', async () => {
    const { getByTestId } = render(
      <ProjectProvider>
        <MapFirstPaintProbe />
      </ProjectProvider>,
    );

    await waitFor(() => {
      expect(getByTestId('rollup-status').textContent).toBe('ready');
    });
    expect(api.graphRollup).toHaveBeenCalledWith('p-1', 1);
    expect(api.graph).not.toHaveBeenCalled();
    expect(api.graphOverview).not.toHaveBeenCalled();
    expect(api.graphNeighbourhood).not.toHaveBeenCalled();
    expect(getByTestId('hub-ids').textContent).toBe('dir:app,dir:lib');
  });
});

function MapDrillProbe() {
  const { ensureMapRollup, ensureMapNeighbourhood, neighbourhoodStatus, graphNeighbourhood, status } = useProject();
  useEffect(() => {
    if (status === 'ready') void ensureMapRollup();
  }, [ensureMapRollup, status]);
  return (
    <div>
      <span data-testid="nb-status">{neighbourhoodStatus}</span>
      <span data-testid="nb-ids">{graphNeighbourhood?.nodes.map((n) => n.id).join(',')}</span>
      <button type="button" onClick={() => void ensureMapNeighbourhood('dir:app')}>drill</button>
    </div>
  );
}

describe('ensureMapNeighbourhood drill path', () => {
  beforeEach(() => {
    vi.mocked(api.graph).mockClear();
    vi.mocked(api.graphOverview).mockClear();
    vi.mocked(api.graphRollup).mockClear();
    vi.mocked(api.graphNeighbourhood).mockClear();
    vi.mocked(api.graphNeighbourhood).mockResolvedValue(
      envelope({
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
        ],
        links: [],
      }),
    );
  });

  it('calls graphNeighbourhood(id, focus, 1) and never api.graph', async () => {
    const { getByTestId, getByRole } = render(
      <ProjectProvider>
        <MapDrillProbe />
      </ProjectProvider>,
    );

    await waitFor(() => {
      expect(api.graphRollup).toHaveBeenCalled();
    });
    fireEvent.click(getByRole('button', { name: 'drill' }));

    await waitFor(() => {
      expect(getByTestId('nb-status').textContent).toBe('ready');
    });
    expect(api.graphNeighbourhood).toHaveBeenCalledWith('p-1', 'dir:app', 1);
    expect(api.graph).not.toHaveBeenCalled();
    expect(api.graphOverview).not.toHaveBeenCalled();
    expect(getByTestId('nb-ids').textContent).toBe('app/A.php');
  });
});
