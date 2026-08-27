import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import CodebaseRadial from './CodebaseRadial';
import type { DiagnosticFinding, GraphEdge, TreeFile } from '../api/client';

// Impact-chain fixture: d.php → c.php → b.php → a.php (one connected component).
const files: TreeFile[] = [
  { path: 'a.php', size: 210, lang: 'php' },
  { path: 'b.php', size: 71, lang: 'php' },
  { path: 'c.php', size: 69, lang: 'php' },
  { path: 'd.php', size: 69, lang: 'php' },
];
const edges: GraphEdge[] = [
  { from: 'b.php', to: 'a.php', kind: 'import', line: 3 },
  { from: 'c.php', to: 'b.php', kind: 'import', line: 3 },
  { from: 'd.php', to: 'c.php', kind: 'import', line: 3 },
];
const findings: DiagnosticFinding[] = [];

function renderMap() {
  return render(
    <CodebaseRadial
      edges={edges}
      findings={findings}
      files={files}
      focusParam={null}
      onFocusTree={() => {}}
    />,
  );
}

describe('CodebaseRadial — map renders', () => {
  it('map canvas does not use size containment (would collapse height to 0 and blank the map)', () => {
    const { container } = renderMap();
    const canvas = container.querySelector<HTMLElement>('[aria-label="Codebase radial map"]');
    expect(canvas).not.toBeNull();

    // `overflow: hidden` clips anything taller than the container. If the container
    // also declares size containment (`contain: strict` / `contain: size`), it is
    // sized as if it had no contents → collapses to ~0px → the SVG is clipped away
    // and the map renders blank. The canvas must therefore never be size-contained.
    const contain = canvas!.style.contain;
    const tokens = contain.split(/\s+/).filter(Boolean);
    expect(contain).not.toBe('strict');
    expect(tokens).not.toContain('size');
    expect(tokens).not.toContain('strict');
  });

  it('renders SVG node/edge geometry without NaN coordinates', () => {
    const { container } = renderMap();
    const svg = container.querySelector('svg[viewBox]');
    expect(svg).not.toBeNull();

    const badCircles: string[] = [];
    svg!.querySelectorAll('circle').forEach((c) => {
      if (c.getAttribute('cx') === 'NaN' || c.getAttribute('cy') === 'NaN') {
        badCircles.push(`cx=${c.getAttribute('cx')} cy=${c.getAttribute('cy')}`);
      }
    });
    const badPaths: string[] = [];
    svg!.querySelectorAll('path').forEach((p) => {
      const d = p.getAttribute('d');
      if (d && d.includes('NaN')) badPaths.push(d);
    });

    expect(badCircles).toEqual([]);
    expect(badPaths).toEqual([]);
    // Sanity: the four files and three edges are actually drawn.
    expect(svg!.querySelectorAll('path').length).toBe(3);
  });
});
