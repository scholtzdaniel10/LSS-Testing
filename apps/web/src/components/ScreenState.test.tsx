import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ScreenState, { LOADING_HINT, toScreenStatus } from './ScreenState';

describe('ScreenState', () => {
  it('maps fetch idle/ready onto note 09 loading/loaded', () => {
    expect(toScreenStatus('idle')).toBe('loading');
    expect(toScreenStatus('ready')).toBe('loaded');
    expect(toScreenStatus('loading')).toBe('loading');
    expect(toScreenStatus('empty')).toBe('empty');
    expect(toScreenStatus('error')).toBe('error');
  });

  it('keeps children mounted while loading when a last frame exists', () => {
    render(
      <ScreenState status="loading" errorMessage={null} emptyHint="">
        <div data-testid="last-frame">previous canvas</div>
      </ScreenState>,
    );

    expect(screen.getByTestId('last-frame')).toHaveTextContent('previous canvas');
    expect(screen.getByRole('status')).toHaveTextContent(LOADING_HINT);
    expect(document.querySelector('.skeleton-block')).toBeNull();
  });

  it('shows a skeleton while loading when there is no last frame', () => {
    render(<ScreenState status="loading" errorMessage={null} emptyHint="" />);

    expect(document.querySelector('.skeleton-block')).not.toBeNull();
    expect(screen.queryByText(LOADING_HINT)).not.toBeInTheDocument();
  });

  it('renders children alone when loaded', () => {
    render(
      <ScreenState status="loaded" errorMessage={null} emptyHint="">
        <div data-testid="last-frame">canvas</div>
      </ScreenState>,
    );

    expect(screen.getByTestId('last-frame')).toBeInTheDocument();
    expect(screen.queryByText(LOADING_HINT)).not.toBeInTheDocument();
  });
});
