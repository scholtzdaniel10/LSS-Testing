import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import Sparkline from './Sparkline';

/**
 * A single-point (freshly-analyzed) or empty trend must never divide by
 * `points.length - 1 === 0` and emit NaN coordinates. Regression for the
 * Health StatTile sparkline blanking / SVG NaN error.
 */
describe('Sparkline — sub-two-point trends stay coordinate-safe', () => {
  it('renders a 1-point trend with no NaN in the path or accent dot', () => {
    const { container } = render(<Sparkline points={[100]} />);
    const path = container.querySelector('path');
    const circle = container.querySelector('circle');
    expect(path!.getAttribute('d')).not.toContain('NaN');
    expect(circle!.getAttribute('cx')).not.toContain('NaN');
    expect(circle!.getAttribute('cy')).not.toContain('NaN');
  });

  it('renders an empty trend with no NaN in the path or accent dot', () => {
    const { container } = render(<Sparkline points={[]} />);
    const path = container.querySelector('path');
    const circle = container.querySelector('circle');
    expect(path!.getAttribute('d')).not.toContain('NaN');
    expect(circle!.getAttribute('cx')).not.toContain('NaN');
    expect(circle!.getAttribute('cy')).not.toContain('NaN');
  });

  it('still draws a multi-point line without NaN', () => {
    const { container } = render(<Sparkline points={[10, 40, 25, 80]} />);
    const path = container.querySelector('path');
    const circle = container.querySelector('circle');
    expect(path!.getAttribute('d')).not.toContain('NaN');
    expect(circle!.getAttribute('cx')).not.toContain('NaN');
    expect(circle!.getAttribute('cy')).not.toContain('NaN');
  });
});
