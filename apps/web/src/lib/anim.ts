import { animate, stagger } from 'animejs';
import { useLayoutEffect, useRef } from 'react';

/*
 * anime.js helpers. Guarded so React 19 StrictMode double-mount doesn't
 * double-run entrances, and cheap to reuse across pages.
 */

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Fade-and-rise entrance for a container's direct [data-animate] children. */
export function useEntrance() {
  const ref = useRef<HTMLDivElement>(null);
  const ran = useRef(false);
  useLayoutEffect(() => {
    if (ran.current || !ref.current) return;
    ran.current = true;
    const targets = ref.current.querySelectorAll<HTMLElement>('[data-animate]');
    if (targets.length === 0 || prefersReducedMotion()) return;
    targets.forEach((el) => {
      el.style.opacity = '0';
    });
    animate(targets, {
      opacity: [0, 1],
      translateY: [8, 0],
      duration: 280,
      delay: stagger(40),
      ease: 'outCubic',
    });
  }, []);
  return ref;
}

/** Count a numeric text node up from 0 without re-rendering React. */
export function useCountUp(value: number, duration = 700) {
  const ref = useRef<HTMLSpanElement>(null);
  const ran = useRef(false);
  useLayoutEffect(() => {
    if (ran.current || !ref.current) return;
    ran.current = true;
    const el = ref.current;
    if (prefersReducedMotion()) {
      el.textContent = String(Math.round(value));
      return;
    }
    const state = { v: 0 };
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
export function drawStroke(el: SVGGeometryElement, delay = 0, duration = 600) {
  const length = pathLength(el);
  if (length === 0 || prefersReducedMotion()) return;
  el.style.strokeDasharray = String(length);
  el.style.strokeDashoffset = String(length);
  animate(el, {
    strokeDashoffset: [length, 0],
    duration,
    delay,
    ease: 'inOutSine',
  });
}
