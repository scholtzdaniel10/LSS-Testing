import { useEffect, useMemo, useRef, useState } from 'react';
import { animate, stagger } from 'animejs';
import { pathLength } from '../lib/anim';
import { dimensions, overallTrend, trendWeeks } from '../mock/data';

const SERIES_COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)'];

const W = 760;
const H = 240;
const PAD = { top: 16, right: 96, bottom: 28, left: 40 };
const Y_MIN = 30;
const Y_MAX = 90;
const TICKS = [40, 60, 80];

const sx = (i: number, n: number) => PAD.left + (i * (W - PAD.left - PAD.right)) / (n - 1);
const sy = (v: number) => PAD.top + ((Y_MAX - v) * (H - PAD.top - PAD.bottom)) / (Y_MAX - Y_MIN);

const pathFor = (values: number[]) =>
  values.map((v, i) => `${i === 0 ? 'M' : 'L'}${sx(i, values.length).toFixed(1)},${sy(v).toFixed(1)}`).join(' ');

/**
 * Score history, 12 weeks. Overall in neutral ink with a direct end label;
 * the four dimensions in the fixed categorical order, toggleable from the
 * legend (color follows the dimension, never its position). Crosshair +
 * tooltip on hover.
 */
const TrendChart: React.FC = () => {
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
  const shown = useMemo(() => dimensions.filter((d) => visible[d.key]), [visible]);

  useEffect(() => {
    if (ran.current || !svgWrapRef.current) return;
    ran.current = true;
    const paths = [...svgWrapRef.current.querySelectorAll<SVGPathElement>('path[data-line]')].filter(
      (p) => pathLength(p) > 0,
    );
    if (paths.length === 0) return;
    paths.forEach((p) => {
      const len = pathLength(p);
      p.style.strokeDasharray = String(len);
      p.style.strokeDashoffset = String(len);
    });
    animate(paths, { strokeDashoffset: 0, duration: 1200, delay: stagger(110), ease: 'inOutSine' });
  }, []);

  const onMove: React.MouseEventHandler<SVGSVGElement> = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((x - PAD.left) / (W - PAD.left - PAD.right)) * (n - 1));
    setHoverI(i >= 0 && i < n ? i : null);
  };

  return (
    <div className="chart" ref={svgWrapRef}>
      <svg viewBox={`0 0 ${W} ${H}`} onMouseMove={onMove} onMouseLeave={() => setHoverI(null)}>
        {TICKS.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={sy(t)} y2={sy(t)} stroke="var(--grid-line)" strokeWidth={1} />
            <text x={PAD.left - 8} y={sy(t) + 3.5} textAnchor="end" fontSize={10} fill="var(--ink-4)">
              {t}
            </text>
          </g>
        ))}
        <line x1={PAD.left} x2={W - PAD.right} y1={sy(Y_MIN)} y2={sy(Y_MIN)} stroke="var(--axis-line)" strokeWidth={1} />
        {[0, Math.floor(n / 2), n - 1].map((i) => (
          <text key={i} x={sx(i, n)} y={H - 8} textAnchor="middle" fontSize={10} fill="var(--ink-4)">
            {trendWeeks[i]}
          </text>
        ))}

        {hoverI !== null && (
          <line x1={sx(hoverI, n)} x2={sx(hoverI, n)} y1={PAD.top} y2={sy(Y_MIN)} stroke="var(--line-2)" strokeWidth={1} />
        )}

        {shown.map((d) => (
          <path
            key={d.key}
            data-line
            d={pathFor(d.trend)}
            fill="none"
            stroke={SERIES_COLORS[dimensions.indexOf(d)]}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        <path data-line d={pathFor(overallTrend)} fill="none" stroke="var(--ink-2)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={sx(n - 1, n)} cy={sy(overallTrend[n - 1])} r={4} fill="var(--ink-1)" stroke="var(--surface-panel)" strokeWidth={2} />
        <text x={sx(n - 1, n) + 10} y={sy(overallTrend[n - 1]) + 4} fontSize={11} fontWeight={600} fill="var(--ink-2)">
          Overall {overallTrend[n - 1]}
        </text>

        {hoverI !== null &&
          shown.map((d) => (
            <circle
              key={d.key}
              cx={sx(hoverI, n)}
              cy={sy(d.trend[hoverI])}
              r={4}
              fill={SERIES_COLORS[dimensions.indexOf(d)]}
              stroke="var(--surface-panel)"
              strokeWidth={2}
            />
          ))}
      </svg>

      {hoverI !== null && (
        <div
          className="chart__tooltip"
          style={{ left: `${(sx(hoverI, n) / W) * 100}%`, top: `${(PAD.top / H) * 100}%` }}
        >
          <strong>{trendWeeks[hoverI]}</strong> · Overall {overallTrend[hoverI]}
          {shown.map((d) => (
            <div key={d.key}>
              {d.label} {d.trend[hoverI]}
            </div>
          ))}
        </div>
      )}

      <div className="legend" role="group" aria-label="Toggle dimensions">
        <span className="legend__item" style={{ cursor: 'default' }}>
          <span className="legend__swatch" style={{ background: 'var(--ink-2)' }} />
          Overall
        </span>
        {dimensions.map((d, i) => (
          <button
            key={d.key}
            type="button"
            className={`legend__item ${visible[d.key] ? '' : 'legend__item--off'}`}
            onClick={() => setVisible((v) => ({ ...v, [d.key]: !v[d.key] }))}
            aria-pressed={visible[d.key]}
          >
            <span className="legend__swatch" style={{ background: SERIES_COLORS[i] }} />
            {d.label}
          </button>
        ))}
      </div>
    </div>
  );
};

export default TrendChart;
