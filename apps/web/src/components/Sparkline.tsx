import { useEffect, useRef } from 'react';
import { drawStroke } from '../lib/anim';

interface Props {
  points: number[];
  width?: number;
  height?: number;
}

/**
 * 12-point stat-tile sparkline: de-emphasis ink for the line, accent dot on
 * the current period (dataviz stat-tile contract).
 */
const Sparkline: React.FC<Props> = ({ points, width = 120, height = 28 }) => {
  const pathRef = useRef<SVGPathElement>(null);
  const ran = useRef(false);

  const pad = 3;
  const midY = height / 2;

  // A line needs at least two points; the X interpolation divides by
  // `points.length - 1`, which is 0 for a single-point trend (0/0 → NaN) and
  // has no last element for an empty trend. Freshly-analyzed projects pass a
  // length-1 trend, so render a flat baseline with one centered accent dot for
  // any sub-two-point trend — visually consistent and coordinate-safe.
  const degenerate = points.length < 2;

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const xy = degenerate
    ? []
    : points.map((v, i) => [
        pad + (i * (width - pad * 2)) / (points.length - 1),
        height - pad - ((v - min) / span) * (height - pad * 2),
      ]);
  const d = degenerate
    ? `M${pad.toFixed(1)},${midY.toFixed(1)} L${(width - pad).toFixed(1)},${midY.toFixed(1)}`
    : xy.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const [lastX, lastY] = degenerate ? [width / 2, midY] : xy[xy.length - 1];

  useEffect(() => {
    if (ran.current || !pathRef.current) return;
    ran.current = true;
    drawStroke(pathRef.current, 250, 700);
  }, []);

  return (
    <svg className="tile__spark" width={width} height={height} aria-hidden="true">
      <path ref={pathRef} d={d} fill="none" stroke="var(--ink-4)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r={4} fill="var(--accent)" stroke="var(--surface-panel)" strokeWidth={2} />
    </svg>
  );
};

export default Sparkline;
