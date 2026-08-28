import { describe, expect, it } from 'vitest';
import { visibleWindow } from './useWindowedList';

describe('visibleWindow', () => {
  it('returns a bounded slice for a large list', () => {
    const { start, end } = visibleWindow(25_000, 0, 240, 24, 8);
    expect(start).toBe(0);
    expect(end - start).toBeLessThanOrEqual(10 + 16);
    expect(end).toBeLessThan(25_000);
  });

  it('shifts the window when scrolled', () => {
    const { start, end } = visibleWindow(25_000, 24 * 100, 240, 24, 8);
    expect(start).toBe(100 - 8);
    expect(end).toBe(100 - 8 + 10 + 16);
  });

  it('clamps to the list bounds', () => {
    const { start, end } = visibleWindow(5, 0, 240, 24, 8);
    expect(start).toBe(0);
    expect(end).toBe(5);
  });
});
