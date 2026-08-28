import { useCallback, useEffect, useRef, useState } from 'react';

export function visibleWindow(
  count: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  overscan = 8,
): { start: number; end: number } {
  if (count <= 0 || rowHeight <= 0) return { start: 0, end: 0 };
  const start = Math.max(0, Math.floor(Math.max(0, scrollTop) / rowHeight) - overscan);
  const viewportRows = Math.ceil(Math.max(viewportHeight, rowHeight) / rowHeight);
  const end = Math.min(count, start + viewportRows + overscan * 2);
  return { start, end };
}

export function useWindowedList(count: number, rowHeight: number, overscan = 8) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState({ start: 0, end: 0 });

  const update = useCallback(() => {
    const el = parentRef.current;
    const scrollTop = el?.scrollTop ?? 0;
    const viewportHeight = el?.clientHeight ?? 0;
    setRange(visibleWindow(count, scrollTop, viewportHeight, rowHeight, overscan));
  }, [count, overscan, rowHeight]);

  useEffect(() => {
    update();
    const el = parentRef.current;
    if (!el) return;
    el.addEventListener('scroll', update, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => update()) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro?.disconnect();
    };
  }, [update]);

  const scrollToIndex = useCallback(
    (index: number) => {
      const el = parentRef.current;
      if (!el || rowHeight <= 0) return;
      const top = index * rowHeight;
      if (top < el.scrollTop || top + rowHeight > el.scrollTop + el.clientHeight) {
        const nextTop = Math.max(0, top - rowHeight * 2);
        if (typeof el.scrollTo === 'function') el.scrollTo({ top: nextTop });
        else el.scrollTop = nextTop;
      }
    },
    [rowHeight],
  );

  return {
    parentRef,
    start: range.start,
    end: range.end,
    scrollToIndex,
    totalHeight: Math.max(0, count * rowHeight),
  };
}
