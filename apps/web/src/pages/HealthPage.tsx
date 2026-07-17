import { useHistory } from 'react-router-dom';
import { useEntrance } from '../lib/anim';
import { dimensions, hotspots, overallScore, program, topIssues } from '../mock/data';
import ScoreRing from '../components/ScoreRing';
import StatTile from '../components/StatTile';
import TrendChart from '../components/TrendChart';
import { SeverityPill } from '../components/StatusPill';

const dimensionRoute: Record<string, string> = {
  errors: '/diagnose',
  dependencies: '/explore',
  tests: '/test',
  structure: '/explore',
};

const HealthPage: React.FC = () => {
  const history = useHistory();
  const ref = useEntrance();

  return (
    <div className="page">
      <div className="page__inner" ref={ref}>
        <div data-animate style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div>
            <h1 className="page__title">Program health</h1>
            <p className="page__subtitle">
              <span className="mono">{program.name}</span> · {program.filesAnalysed.toLocaleString()} files analysed ·
              last scan {program.importedAt}
            </p>
          </div>
          <button type="button" className="btn btn--accent">
            Re-scan program
          </button>
        </div>

        <div className="health-hero" data-animate>
          <div className="panel">
            <ScoreRing overall={overallScore.score} dims={dimensions} />
          </div>
          <div className="panel">
            <div className="panel__head">
              <h2 className="panel__title">Score history</h2>
              <span className="panel__hint">12 weeks · weekly snapshots</span>
            </div>
            <TrendChart />
          </div>
        </div>

        <div className="tile-row">
          {dimensions.map((d) => (
            <StatTile key={d.key} dim={d} onOpen={() => history.push(dimensionRoute[d.key])} />
          ))}
        </div>

        <div className="split" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="panel" data-animate>
            <div className="panel__head">
              <h2 className="panel__title">Top issues</h2>
              <span className="panel__hint">worst first · click lands on the evidence</span>
            </div>
            <div className="row-list">
              {topIssues.map((issue) => (
                <div
                  key={issue.summary}
                  className="row-list__row"
                  role="button"
                  tabIndex={0}
                  onClick={() => history.push(dimensionRoute[issue.dimension])}
                  onKeyDown={(e) => e.key === 'Enter' && history.push(dimensionRoute[issue.dimension])}
                >
                  <SeverityPill severity={issue.severity} />
                  <span className="row-list__grow">{issue.summary}</span>
                  <span className="row-list__meta">{issue.ref}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="panel" data-animate>
            <div className="panel__head">
              <h2 className="panel__title">Hotspot files</h2>
              <span className="panel__hint">dependency centrality × error density</span>
            </div>
            <div className="row-list">
              {hotspots.map((h) => (
                <div
                  key={h.file}
                  className="row-list__row"
                  role="button"
                  tabIndex={0}
                  onClick={() => history.push('/explore')}
                  onKeyDown={(e) => e.key === 'Enter' && history.push('/explore')}
                >
                  <span className="row-list__grow mono">{h.file}</span>
                  <span className="row-list__meta">
                    c {h.centrality.toFixed(2)} · e {h.errorDensity.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <p className="v0-banner" data-animate>
          v0 preview — every number here is mock data shaped to contract C2; the real snapshot builder is task HD-2.
        </p>
      </div>
    </div>
  );
};

export default HealthPage;
