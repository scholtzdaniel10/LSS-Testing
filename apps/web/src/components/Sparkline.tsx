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

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const pad = 3;
  const xy = points.map((v, i) => [
    pad + (i * (width - pad * 2)) / (points.length - 1),
    height - pad - ((v - min) / span) * (height - pad * 2),
  ]);
  const d = xy.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const [lastX, lastY] = xy[xy.length - 1];

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
