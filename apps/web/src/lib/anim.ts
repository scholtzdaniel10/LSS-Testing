import { animate, stagger } from 'animejs';
import { useEffect, useRef } from 'react';

/*
 * anime.js helpers. Guarded so React 19 StrictMode double-mount doesn't
 * double-run entrances, and cheap to reuse across pages.
 */

/** Fade-and-rise entrance for a container's direct [data-animate] children. */
export function useEntrance() {
  const ref = useRef<HTMLDivElement>(null);
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current || !ref.current) return;
    ran.current = true;
    const targets = ref.current.querySelectorAll('[data-animate]');
    animate(targets, {
      opacity: [0, 1],
      translateY: [14, 0],
      duration: 550,
      delay: stagger(70),
      ease: 'outCubic',
    });
  }, []);
  return ref;
}

/** Count a numeric text node up from 0 without re-rendering React. */
export function useCountUp(value: number, duration = 1100) {
  const ref = useRef<HTMLSpanElement>(null);
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current || !ref.current) return;
    ran.current = true;
    const state = { v: 0 };
    const el = ref.current;
    animate(state, {
      v: value,
      duration,
      ease: 'outQuart',
      onUpdate: () => {
        el.textContent = String(Math.round(state.v));
      },
    });
  }, [value, duration]);
  return ref;
}

/** SVG path length, or 0 where the environment (jsdom) doesn't implement it. */
export function pathLength(el: SVGGeometryElement): number {
  return typeof el.getTotalLength === 'function' ? el.getTotalLength() : 0;
}

/** Draw an SVG stroke in (line charts, ring arcs). No-ops without a length. */
export function drawStroke(el: SVGGeometryElement, delay = 0, duration = 900) {
  const length = pathLength(el);
  if (length === 0) return;
  el.style.strokeDasharray = String(length);
  el.style.strokeDashoffset = String(length);
  animate(el, {
    strokeDashoffset: [length, 0],
    duration,
    delay,
    ease: 'inOutSine',
  });
}
