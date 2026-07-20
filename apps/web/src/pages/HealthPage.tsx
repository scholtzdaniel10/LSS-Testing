import { useHistory } from 'react-router-dom';
import { useEntrance } from '../lib/anim';
import ScoreRing from '../components/ScoreRing';
import StatTile from '../components/StatTile';
import TrendChart from '../components/TrendChart';
import { SeverityPill } from '../components/StatusPill';
import ScreenState from '../components/ScreenState';
import { useProject } from '../state/ProjectContext';
import type { DimensionScore } from '../types';

const dimensionRoute: Record<string, string> = {
  errors: '/diagnose',
  dependencies: '/explore',
  tests: '/test',
  structure: '/explore',
};

function buildDimensions(health: NonNullable<ReturnType<typeof useProject>['health']>): DimensionScore[] {
  const m = health.metrics;
  const s = health.scores;
  return [
    {
      key: 'errors',
      label: 'Errors',
      score: s.errors,
      delta: 0,
      detail: `${m.errorCounts.error} errors, ${m.errorCounts.warning} warnings, ${m.errorChains} chains`,
      trend: [],
    },
    {
      key: 'dependencies',
      label: 'Dependencies',
      score: s.dependencies,
      delta: 0,
      detail: `${m.missingDeps} missing, ${m.outdatedDeps} outdated, ${m.undeclaredEnvVars} env vars`,
      trend: [],
    },
    {
      key: 'tests',
      label: 'Tests',
      score: s.tests,
      delta: 0,
      detail: m.testsTotal === 0 ? 'No test runs yet (TST track)' : `${Math.round(m.testPassRate * 100)}% of ${m.testsTotal}`,
      trend: [],
    },
    {
      key: 'structure',
      label: 'Structure',
      score: s.structure,
      delta: 0,
      detail: `${m.hotspots.length} hotspot files`,
      trend: [],
    },
  ];
}

const HealthPage: React.FC = () => {
  const history = useHistory();
  const ref = useEntrance();
  const { project, health, healthHistory, status, errorMessage, rescan, jobMessage } = useProject();

  const dimensions = health ? buildDimensions(health) : [];
  const overallTrend = healthHistory
    .slice()
    .reverse()
    .map((h) => h.scores.overall);
  const weeks = healthHistory
    .slice()
    .reverse()
    .map((h) => new Date(h.takenAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));

  // Fill dimension trends from history when available
  const dimsWithTrend = dimensions.map((d) => ({
    ...d,
    trend: healthHistory
      .slice()
      .reverse()
      .map((h) => h.scores[d.key]),
  }));

  return (
    <div className="page">
      <div className="page__inner" ref={ref}>
        <div data-animate style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div>
            <h1 className="page__title">Program health</h1>
            <p className="page__subtitle">
              {project ? (
                <>
                  <span className="mono">{project.name}</span>
                  {health ? (
                    <>
                      {' '}
                      · {health.metrics.filesAnalysed.toLocaleString()} files analysed · last scan{' '}
                      {new Date(health.takenAt).toLocaleString()}
                    </>
                  ) : null}
                </>
              ) : (
                'Select or import a program to see health.'
              )}
            </p>
          </div>
          <button type="button" className="btn btn--accent" onClick={() => void rescan()} disabled={!project}>
            Re-scan program
          </button>
        </div>
        {jobMessage && <p className="panel__hint" data-animate>{jobMessage}</p>}

        <ScreenState
          status={status === 'ready' && !health ? 'empty' : status}
          errorMessage={errorMessage}
          emptyHint="No health snapshot yet. Import a program, then hit Re-scan."
        >
          {health && (
            <>
              <div className="health-hero" data-animate>
                <div className="panel">
                  <ScoreRing overall={health.scores.overall} dims={dimsWithTrend} />
                </div>
                <div className="panel">
                  <div className="panel__head">
                    <h2 className="panel__title">Score history</h2>
                    <span className="panel__hint">{healthHistory.length} snapshots</span>
                  </div>
                  <TrendChart overallTrend={overallTrend.length ? overallTrend : [health.scores.overall, health.scores.overall]} weeks={weeks.length ? weeks : ['now', 'now']} dimensions={dimsWithTrend} />
                </div>
              </div>

              <div className="tile-row">
                {dimsWithTrend.map((d) => (
                  <StatTile key={d.key} dim={d} onOpen={() => history.push(dimensionRoute[d.key])} />
                ))}
              </div>

              <div className="split" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <div className="panel" data-animate>
                  <div className="panel__head">
                    <h2 className="panel__title">Top issues</h2>
                    <span className="panel__hint">worst first · click lands on evidence</span>
                  </div>
                  <div className="row-list">
                    {health.topIssues.length === 0 && (
                      <p className="page__subtitle">No top issues in this snapshot.</p>
                    )}
                    {health.topIssues.map((issue) => (
                      <div
                        key={issue.summary + issue.refId}
                        className="row-list__row"
                        role="button"
                        tabIndex={0}
                        onClick={() => history.push(dimensionRoute[issue.dimension] ?? '/diagnose')}
                        onKeyDown={(e) => e.key === 'Enter' && history.push(dimensionRoute[issue.dimension] ?? '/diagnose')}
                      >
                        <SeverityPill severity={issue.dimension === 'errors' ? 'critical' : 'warning'} />
                        <span className="row-list__grow">{issue.summary}</span>
                        <span className="row-list__meta">{issue.refId}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="panel" data-animate>
                  <div className="panel__head">
                    <h2 className="panel__title">Hotspots</h2>
                    <span className="panel__hint">central + error-dense</span>
                  </div>
                  <div className="row-list">
                    {health.metrics.hotspots.map((h) => (
                      <div key={h.file} className="row-list__row">
                        <span className="row-list__grow mono">{h.file}</span>
                        <span className="row-list__meta">
                          c={h.centrality} · e={h.errorDensity}
                        </span>
                      </div>
                    ))}
                    {health.metrics.hotspots.length === 0 && (
                      <p className="page__subtitle">No hotspots above threshold.</p>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </ScreenState>
      </div>
    </div>
  );
};

export default HealthPage;
