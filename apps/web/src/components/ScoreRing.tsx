import { useEffect, useRef } from 'react';
import { pathLength, useCountUp } from '../lib/anim';
import { animate, stagger } from 'animejs';
import type { DimensionScore } from '../mock/data';

const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)'];

/**
 * The hero: overall score inside a segmented radial dial (a nod to the
 * animejs.com dial). Each quarter arc is one dimension; arc sweep = its score.
 * Identity is carried by the tile row beneath (same fixed series order), not
 * by color alone.
 */
const ScoreRing: React.FC<{ overall: number; dims: DimensionScore[] }> = ({ overall, dims }) => {
  const valueRef = useCountUp(overall, 1400);
  const groupRef = useRef<SVGGElement>(null);
  const ran = useRef(false);

  const size = 260;
  const c = size / 2;
  const r = 108;
  const gapDeg = 10;
  const quarter = 90 - gapDeg;

  const arc = (startDeg: number, sweepDeg: number, radius: number) => {
    const a0 = ((startDeg - 90) * Math.PI) / 180;
    const a1 = ((startDeg + sweepDeg - 90) * Math.PI) / 180;
    const large = sweepDeg > 180 ? 1 : 0;
    return `M ${c + radius * Math.cos(a0)} ${c + radius * Math.sin(a0)} A ${radius} ${radius} 0 ${large} 1 ${
      c + radius * Math.cos(a1)
    } ${c + radius * Math.sin(a1)}`;
  };

  useEffect(() => {
    if (ran.current || !groupRef.current) return;
    ran.current = true;
    const paths = [...groupRef.current.querySelectorAll<SVGPathElement>('path[data-arc]')].filter(
      (p) => pathLength(p) > 0,
    );
    if (paths.length === 0) return;
    paths.forEach((p) => {
      const len = pathLength(p);
      p.style.strokeDasharray = String(len);
      p.style.strokeDashoffset = String(len);
    });
    animate(paths, {
      strokeDashoffset: 0,
      duration: 1100,
      delay: stagger(140),
      ease: 'inOutQuart',
    });
  }, []);

  return (
    <div className="score-ring" data-animate>
      <svg width={size} height={size} role="img" aria-label={`Overall health ${overall} of 100`}>
        <g ref={groupRef}>
          {dims.map((dim, i) => {
            const start = i * 90 + gapDeg / 2;
            return (
              <g key={dim.key}>
                <path d={arc(start, quarter, r)} fill="none" stroke="var(--line-1)" strokeWidth={3} strokeLinecap="round" />
                <path
                  data-arc
                  d={arc(start, (quarter * dim.score) / 100, r)}
                  fill="none"
                  stroke={SERIES[i]}
                  strokeWidth={6}
                  strokeLinecap="round"
                />
              </g>
            );
          })}
        </g>
        <text x={c} y={c - 4} textAnchor="middle" dominantBaseline="middle" className="score-ring__value">
          <tspan ref={valueRef as React.Ref<SVGTSpanElement>}>0</tspan>
        </text>
        <text x={c} y={c + 34} textAnchor="middle" className="score-ring__caption">
          overall health / 100
        </text>
      </svg>
    </div>
  );
};

export default ScoreRing;
