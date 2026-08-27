// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom/extend-expect';

// Mock matchmedia
window.matchMedia = window.matchMedia || function() {
  return {
      matches: false,
      addListener: function() {},
      removeListener: function() {}
  };
};

// jsdom has no ResizeObserver. Provide a controllable mock so components that
// re-fit on measurement (CodebaseRadial, DependencyGraph) can mount, and tests
// can drive a measurement by invoking the stored callbacks.
type ResizeObserverCb = (entries: ResizeObserverEntry[], observer: ResizeObserver) => void;

class ResizeObserverMock {
  callback: ResizeObserverCb;
  constructor(callback: ResizeObserverCb) {
    this.callback = callback;
    resizeObserverMocks.push(this);
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/** Every ResizeObserver constructed during a test, so tests can fire them. */
export const resizeObserverMocks: ResizeObserverMock[] = [];

/** Invoke every observed callback (simulates the browser measuring the box). */
export function triggerResizeObservers(): void {
  for (const ro of resizeObserverMocks) {
    ro.callback([], ro as unknown as ResizeObserver);
  }
}

globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
