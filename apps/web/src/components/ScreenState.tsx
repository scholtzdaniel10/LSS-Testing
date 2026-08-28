import type { ReactNode } from 'react';

/** Note 09 screen states. Fetch `idle`/`ready` map in via `toScreenStatus`. */
export type ScreenStatus = 'loaded' | 'empty' | 'loading' | 'error';

export const LOADING_HINT = 'Loading…';

export function toScreenStatus(
  status: 'idle' | 'loading' | 'ready' | 'empty' | 'error' | ScreenStatus,
): ScreenStatus {
  if (status === 'idle') return 'loading';
  if (status === 'ready') return 'loaded';
  return status;
}

function hasLastFrame(children: ReactNode): boolean {
  return children != null && children !== false && children !== true;
}

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
  if (status === 'loading') {
    if (hasLastFrame(children)) {
      return (
        <>
          {children}
          <p className="panel__hint screen-state__loading-hint" role="status">
            {LOADING_HINT}
          </p>
        </>
      );
    }
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
  return <>{children}</>;
}

export default ScreenState;
