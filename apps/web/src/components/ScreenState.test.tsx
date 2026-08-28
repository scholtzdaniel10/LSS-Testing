import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ScreenState, { COMPUTING_HINT } from './ScreenState';

describe('ScreenState', () => {
  it('keeps children mounted while computing and shows a Laying out hint', () => {
    render(
      <ScreenState status="computing" errorMessage={null} emptyHint="">
        <div data-testid="last-frame">previous canvas</div>
      </ScreenState>,
    );

    expect(screen.getByTestId('last-frame')).toHaveTextContent('previous canvas');
    expect(screen.getByRole('status')).toHaveTextContent(COMPUTING_HINT);
    expect(document.querySelector('.skeleton-block')).toBeNull();
  });

  it('replaces children with a skeleton while loading', () => {
    render(
      <ScreenState status="loading" errorMessage={null} emptyHint="">
        <div data-testid="last-frame">previous canvas</div>
      </ScreenState>,
    );

    expect(screen.queryByTestId('last-frame')).not.toBeInTheDocument();
    expect(document.querySelector('.skeleton-block')).not.toBeNull();
    expect(screen.queryByText(COMPUTING_HINT)).not.toBeInTheDocument();
  });

  it('renders children alone when ready', () => {
    render(
      <ScreenState status="ready" errorMessage={null} emptyHint="">
        <div data-testid="last-frame">canvas</div>
      </ScreenState>,
    );

    expect(screen.getByTestId('last-frame')).toBeInTheDocument();
    expect(screen.queryByText(COMPUTING_HINT)).not.toBeInTheDocument();
  });
});
