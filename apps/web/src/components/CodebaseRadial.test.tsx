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

/**
 * Render with the SVG canvas reporting a real, non-zero measured width.
 * jsdom reports `clientWidth === 0` for every element, so the width-dependent
 * fit/centre code path never runs under a plain render. Stubbing `clientWidth`
 * exercises the same X math the live browser runs.
 */
function renderMapWithWidth(width: number) {
  const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth');
  Object.defineProperty(Element.prototype, 'clientWidth', {
    configurable: true,
    get() { return width; },
  });
  try {
    return renderMap();
  } finally {
    if (desc) Object.defineProperty(Element.prototype, 'clientWidth', desc);
    else delete (Element.prototype as unknown as Record<string, unknown>).clientWidth;
  }
}

/** Parse the `scale(...)`/`translate(...)` numbers off the pan/zoom root <g>. */
function readTransform(container: HTMLElement): { scale: number; tx: number; ty: number } {
  const g = container.querySelector('svg[viewBox] > g');
  const t = g?.getAttribute('transform') ?? '';
  const scale = Number(/scale\(([-\d.eE]+)\)/.exec(t)?.[1] ?? 'NaN');
  const [tx, ty] = (/translate\(([-\d.eE]+),([-\d.eE]+)\)/.exec(t)?.slice(1, 3) ?? ['NaN', 'NaN']).map(Number);
  return { scale, tx, ty };
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

  it('renders finite SVG geometry when the canvas has a REAL measured width', () => {
    // Reproduces the live-browser condition (non-zero width) that the width=0
    // jsdom render cannot: the fit/centre X math actually executes here.
    const { container } = renderMapWithWidth(640);
    const svg = container.querySelector('svg[viewBox]');
    expect(svg).not.toBeNull();

    const bad: string[] = [];
    svg!.querySelectorAll('circle').forEach((c) => {
      const cx = c.getAttribute('cx');
      const cy = c.getAttribute('cy');
      if (cx === 'NaN' || cy === 'NaN') bad.push(`cx=${cx} cy=${cy}`);
    });
    svg!.querySelectorAll('path').forEach((p) => {
      const d = p.getAttribute('d');
      if (d && d.includes('NaN')) bad.push(`d=${d}`);
    });
    expect(bad).toEqual([]);

    // The pan/zoom transform must also be finite at a real width.
    const { scale, tx, ty } = readTransform(container);
    expect(Number.isFinite(scale)).toBe(true);
    expect(Number.isFinite(tx)).toBe(true);
    expect(Number.isFinite(ty)).toBe(true);
  });

  it('does not collapse the fit when the canvas width is still unmeasured (0)', () => {
    // Regression: `clientWidth ?? SVG_WIDTH` did not catch clientWidth === 0
    // (0 is not nullish), so the fit divided the viewport by an unmeasured
    // width — clamping zoom to its 0.2 floor and panning the map off the left
    // edge (translateX < 0), which reads as a blank Map. With the fix an
    // unmeasured width falls back to the fixed canvas width, yielding a sane,
    // on-screen fit.
    const { container } = renderMap(); // jsdom reports clientWidth === 0
    const { scale, tx } = readTransform(container);
    expect(Number.isFinite(scale)).toBe(true);
    // The degenerate collapse produced scale === 0.2 (the floor) and tx === -124.
    expect(scale).toBeGreaterThan(0.2);
    expect(tx).toBeGreaterThan(0);
  });
});
