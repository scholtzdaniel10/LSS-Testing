import { useCountUp } from '../lib/anim';
import type { DimensionScore } from '../types';
import Sparkline from './Sparkline';
import StatusPill from './StatusPill';

/**
 * Dataviz stat-tile contract: label · value · signed delta (color = direction,
 * up is good for a health score) · sparkline. Whole tile clicks through to its
 * evidence screen (HD rule: every number lands on evidence).
 */
const StatTile: React.FC<{ dim: DimensionScore; onOpen: () => void }> = ({ dim, onOpen }) => {
  const valueRef = useCountUp(dim.score);
  return (
    <button type="button" className="tile" data-animate onClick={onOpen} aria-label={`${dim.label}: ${dim.score} of 100. ${dim.detail}. Open details.`}>
      <span className="tile__label">{dim.label}</span>
      <span className="tile__value-row">
        <span className="tile__value">
          <span ref={valueRef}>0</span>
          <span style={{ color: 'var(--ink-4)', fontSize: 'var(--text-sm)', fontWeight: 400 }}> /100</span>
        </span>
        {dim.delta !== 0 && (
          <span className={`tile__delta ${dim.delta > 0 ? 'tile__delta--up' : 'tile__delta--down'}`}>
            {dim.delta > 0 ? '+' : ''}
            {dim.delta} vs last scan
          </span>
        )}
      </span>
      <StatusPill score={dim.score} />
      <Sparkline points={dim.trend} />
      <span className="panel__hint">{dim.detail}</span>
    </button>
  );
};

export default StatTile;
