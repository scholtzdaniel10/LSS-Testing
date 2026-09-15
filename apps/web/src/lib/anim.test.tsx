import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { prefersReducedMotion, useCountUp, useEntrance } from './anim';

function stubMatchMedia(matches: boolean) {
  window.matchMedia = (query: string) =>
    ({
      matches,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    }) as MediaQueryList;
}

function Count({ value }: { value: number }) {
  const ref = useCountUp(value);
  return <span data-testid="count" ref={ref}>0</span>;
}

function Entrance() {
  const ref = useEntrance();
  return (
    <div ref={ref}>
      <p data-animate>Ready</p>
    </div>
  );
}

describe('prefersReducedMotion', () => {
  afterEach(() => {
    stubMatchMedia(false);
  });

  it('is false when the query does not match', () => {
    stubMatchMedia(false);
    expect(prefersReducedMotion()).toBe(false);
  });

  it('is true when reduce is requested', () => {
    stubMatchMedia(true);
    expect(prefersReducedMotion()).toBe(true);
  });
});

describe('useCountUp', () => {
  afterEach(() => {
    stubMatchMedia(false);
  });

  it('writes the target immediately when motion is reduced', () => {
    stubMatchMedia(true);
    render(<Count value={42} />);
    expect(screen.getByTestId('count')).toHaveTextContent('42');
  });
});

describe('useEntrance', () => {
  afterEach(() => {
    stubMatchMedia(false);
  });

  it('leaves content visible when motion is reduced', () => {
    stubMatchMedia(true);
    render(<Entrance />);
    const el = screen.getByText('Ready');
    expect(el.style.opacity).not.toBe('0');
  });
});
