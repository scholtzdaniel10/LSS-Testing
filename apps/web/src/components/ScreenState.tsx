import type { ReactNode } from 'react';

export type ScreenStatus = 'idle' | 'loading' | 'computing' | 'ready' | 'empty' | 'error';

export const COMPUTING_HINT = 'Laying out…';

export function ScreenState({
  status,
  errorMessage,
  emptyHint,
  children,
}: {
  status: ScreenStatus;
  errorMessage: string | null;
  emptyHint: string;
  children?: ReactNode;
}) {
  if (status === 'loading' || status === 'idle') {
    return (
      <div className="panel" data-animate>
        <div className="skeleton-block" aria-busy="true">
          <div className="skeleton-line" />
          <div className="skeleton-line" style={{ width: '70%' }} />
          <div className="skeleton-line" style={{ width: '55%' }} />
        </div>
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="panel panel--error" data-animate role="alert">
        <h2 className="panel__title">Could not load</h2>
        <p className="page__subtitle">{errorMessage ?? 'Unknown error'}</p>
        <p className="field__hint">Check the API is running and your bearer token in Settings.</p>
      </div>
    );
  }
  if (status === 'empty') {
    return (
      <div className="panel" data-animate>
        <h2 className="panel__title">Nothing here yet</h2>
        <p className="page__subtitle">{emptyHint}</p>
      </div>
    );
  }
  return (
    <>
      {children}
      {status === 'computing' ? (
        <p className="panel__hint screen-state__computing-hint" role="status">
          {COMPUTING_HINT}
        </p>
      ) : null}
    </>
  );
}

export default ScreenState;
