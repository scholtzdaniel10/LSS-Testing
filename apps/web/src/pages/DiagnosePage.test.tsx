import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DiagnosePage from './DiagnosePage';
import type { DiagnosticFinding, ErrorChain } from '../api/client';

// DX-11/13 component tests: a 4-error chain (a.php root ← b ← c ← d) rendered
// grouped with the root first, then walked end-to-end via the popover without
// leaving the pane (the DX-13 acceptance criterion).

const finding = (id: string, file: string, upstream: string[], downstream: string[]): DiagnosticFinding => ({
  id,
  source: 'phpstan',
  ruleId: 'return.type',
  kind: 'type-error',
  severity: 'error',
  file,
  range: { startLine: 1, startCol: 1, endLine: 1, endCol: 10 },
  message: `broken in ${file}`,
  explanation: `explained: ${file}`,
  upstream,
  downstream,
});

const errors: DiagnosticFinding[] = [
  finding('e-a', 'a.php', [], ['b.php']),
  finding('e-b', 'b.php', ['a.php'], ['c.php']),
  finding('e-c', 'c.php', ['b.php'], ['d.php']),
  finding('e-d', 'd.php', ['c.php'], []),
  finding('e-lone', 'lone.php', [], []),
];

const chains: ErrorChain[] = [
  { chainId: 'ch-1', rootErrorIds: ['e-a'], errorIds: ['e-a', 'e-b', 'e-c', 'e-d'] },
];

vi.mock('../state/ProjectContext', () => ({
  useProject: () => ({
    project: { id: 'p-1', name: 'Demo', sandboxPath: null, lastImportedAt: null, createdAt: null, updatedAt: null },
    errors,
    analysers: { phpstan: 'ok' },
    chains,
    status: 'ready',
    errorMessage: null,
  }),
}));

vi.mock('../api/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('../api/client')>();
  return {
    ...original,
    api: {
      ...original.api,
      file: vi.fn(async (_projectId: string, path: string) => ({
        data: { path, binary: false, content: 'line one\nline two\nline three', size: 30, lang: 'php' },
        meta: {},
        errors: [],
      })),
    },
  };
});

function renderPage() {
  return render(
    <MemoryRouter>
      <DiagnosePage />
    </MemoryRouter>,
  );
}

async function hoverHighlight(container: HTMLElement) {
  await waitFor(() => {
    expect(container.querySelector('.code-pane__line--hl')).not.toBeNull();
  });
  fireEvent.mouseEnter(container.querySelector('.code-pane__line--hl') as HTMLElement);
}

describe('DiagnosePage — DX-11 chain list view', () => {
  it('groups chained findings with the root cause first and unchained after', async () => {
    renderPage();
    // let the initial async file load settle to avoid act() warnings
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'a.php' })).toBeInTheDocument();
    });

    const group = screen.getByRole('group', { name: 'Error chain of 4' });
    expect(group).toHaveTextContent('root cause');
    expect(group).toHaveTextContent('broken in a.php');
    // collapsed by default: only the root row is visible
    expect(group).not.toHaveTextContent('broken in b.php');
    // unchained finding still listed
    expect(screen.getByText('broken in lone.php')).toBeInTheDocument();
  });

  it('expands the chain to show the other affected errors', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'a.php' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Expand chain of 4 errors' }));

    await waitFor(() => {
      const group = screen.getByRole('group', { name: 'Error chain of 4' });
      expect(group).toHaveTextContent('broken in b.php');
      expect(group).toHaveTextContent('broken in c.php');
      expect(group).toHaveTextContent('broken in d.php');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Collapse chain of 4 errors' }));
    await waitFor(() => {
      expect(screen.getByRole('group', { name: 'Error chain of 4' })).not.toHaveTextContent('broken in b.php');
    });
  });
});

describe('DiagnosePage — DX-13 popover chain walking', () => {
  it('shows kind + explanation and walks a 4-error chain end-to-end in the pane', async () => {
    const { container } = renderPage();

    // active defaults to the first finding (a.php, the root)
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'a.php' })).toBeInTheDocument();
    });

    // hop a.php → b.php → c.php → d.php via the popover downstream links
    for (const next of ['b.php', 'c.php', 'd.php']) {
      await hoverHighlight(container);
      const popover = screen.getByRole('dialog', { name: 'Impact and chain details' });
      expect(popover).toHaveTextContent('type-error');
      expect(popover).toHaveTextContent('explained:');
      fireEvent.click(screen.getByRole('button', { name: `Go to error in ${next}` }));
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: next })).toBeInTheDocument();
      });
    }

    // and back to the root directly through the chain member list
    await hoverHighlight(container);
    fireEvent.click(screen.getByRole('button', { name: 'Go to chain error in a.php' }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'a.php' })).toBeInTheDocument();
    });
  });
});
