import { useEffect, useMemo, useRef, useState } from 'react';
import { animate, stagger } from 'animejs';
import { pathLength } from '../lib/anim';
import type { DimensionScore } from '../types';

const SERIES_COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)'];

const W = 760;
const H = 240;
const PAD = { top: 16, right: 96, bottom: 28, left: 40 };
const Y_MIN = 30;
const Y_MAX = 90;
const TICKS = [40, 60, 80];

const sx = (i: number, n: number) => PAD.left + (i * (W - PAD.left - PAD.right)) / Math.max(n - 1, 1);
const sy = (v: number) => PAD.top + ((Y_MAX - v) * (H - PAD.top - PAD.bottom)) / (Y_MAX - Y_MIN);

const pathFor = (values: number[]) =>
  values.map((v, i) => `${i === 0 ? 'M' : 'L'}${sx(i, values.length).toFixed(1)},${sy(v).toFixed(1)}`).join(' ');

type Props = {
  overallTrend: number[];
  weeks: string[];
  dimensions: DimensionScore[];
};

const TrendChart: React.FC<Props> = ({ overallTrend, weeks, dimensions }) => {
  const [visible, setVisible] = useState<Record<string, boolean>>({
    errors: true,
    dependencies: true,
    tests: true,
    structure: true,
  });
  const [hoverI, setHoverI] = useState<number | null>(null);
  const svgWrapRef = useRef<HTMLDivElement>(null);
  const ran = useRef(false);

  const n = overallTrend.length;
  const shown = useMemo(() => dimensions.filter((d) => visible[d.key]), [visible, dimensions]);

  useEffect(() => {
    if (ran.current || !svgWrapRef.current || n < 2) return;
    ran.current = true;
    const paths = [...svgWrapRef.current.querySelectorAll<SVGPathElement>('path[data-trend]')].filter(
      (p) => pathLength(p) > 0,
    );
    paths.forEach((p) => {
      const len = pathLength(p);
      p.style.strokeDasharray = `${len}`;
      p.style.strokeDashoffset = `${len}`;
    });
    animate(paths, {
      strokeDashoffset: 0,
      duration: 900,
      delay: stagger(80),
      ease: 'inOutCubic',
    });
  }, [n]);

  if (n < 2) {
    return <p className="page__subtitle">Not enough snapshots yet for a trend.</p>;
  }

  return (
    <div ref={svgWrapRef}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Score history">
        {TICKS.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={sy(t)} y2={sy(t)} stroke="var(--line-1)" />
            <text x={PAD.left - 8} y={sy(t) + 4} textAnchor="end" fill="var(--ink-4)" fontSize="11">
              {t}
            </text>
          </g>
        ))}
        <path d={pathFor(overallTrend)} fill="none" stroke="var(--ink-2)" strokeWidth="2.5" data-trend />
        {shown.map((d, i) => (
          <path
            key={d.key}
            d={pathFor(d.trend.length === n ? d.trend : overallTrend)}
            fill="none"
            stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
            strokeWidth="1.5"
            opacity={0.85}
            data-trend
          />
        ))}
        {overallTrend.map((_, i) => (
          <circle
            key={i}
            cx={sx(i, n)}
            cy={sy(overallTrend[i])}
            r={hoverI === i ? 5 : 3}
            fill="var(--ink-1)"
            onMouseEnter={() => setHoverI(i)}
            onMouseLeave={() => setHoverI(null)}
          />
        ))}
        {weeks.map((w, i) =>
          i % Math.ceil(n / 6) === 0 ? (
            <text key={w + i} x={sx(i, n)} y={H - 8} textAnchor="middle" fill="var(--ink-4)" fontSize="10">
              {w}
            </text>
          ) : null,
        )}
      </svg>
      <div className="legend" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
        {dimensions.map((d, i) => (
          <button
            key={d.key}
            type="button"
            className="btn"
            style={{ opacity: visible[d.key] ? 1 : 0.4, borderColor: SERIES_COLORS[i % 4] }}
            onClick={() => setVisible((v) => ({ ...v, [d.key]: !v[d.key] }))}
          >
            {d.label}
          </button>
        ))}
      </div>
      {hoverI !== null && (
        <p className="panel__hint">
          {weeks[hoverI] ?? `#${hoverI}`}: overall {overallTrend[hoverI]}
        </p>
      )}
    </div>
  );
};

export default TrendChart;
