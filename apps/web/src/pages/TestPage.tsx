import { useState } from 'react';
import { useEntrance } from '../lib/anim';
import { targetEnv, tests, type BrowserTest } from '../mock/data';

const runColor = (r: 'pass' | 'fail') => (r === 'pass' ? 'var(--status-good)' : 'var(--status-critical)');

const TestPage: React.FC = () => {
  const ref = useEntrance();
  const [active, setActive] = useState<BrowserTest>(tests[0]);

  return (
    <div className="page">
      <div className="page__inner" ref={ref} style={{ maxWidth: 1320 }}>
        <div data-animate style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div>
            <h1 className="page__title">Test</h1>
            <p className="page__subtitle">
              Pest / Playwright tests fabricated against{' '}
              <span className="mono">{targetEnv.baseUrl}</span> — right-click an element in the live app to add a step.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
            <button type="button" className="btn">
              Record session
            </button>
            <button type="button" className="btn btn--accent">
              Run suite
            </button>
          </div>
        </div>

        <div className="split" data-animate>
          <div className="panel">
            <div className="panel__head">
              <h2 className="panel__title">Tests</h2>
              <span className="panel__hint">last 7 runs</span>
            </div>
            <div className="row-list">
              {tests.map((t) => (
                <div
                  key={t.id}
                  className="row-list__row"
                  style={active.id === t.id ? { background: 'var(--surface-raised)' } : undefined}
                  role="button"
                  tabIndex={0}
                  onClick={() => setActive(t)}
                  onKeyDown={(e) => e.key === 'Enter' && setActive(t)}
                >
                  <span className="row-list__grow">{t.name}</span>
                  <span className="run-bar" aria-label={`${t.runs.filter((r) => r === 'pass').length} of ${t.runs.length} passing`}>
                    {t.runs.map((r, i) => (
                      <span key={i} className="run-bar__cell" style={{ background: runColor(r) }} />
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <div className="panel__head">
              <h2 className="panel__title">{active.name} — steps of operation</h2>
              <span className="panel__hint">last run {active.lastRun}</span>
            </div>
            <div className="row-list">
              {active.steps.map((s, i) => (
                <div key={i} className="row-list__row" style={{ cursor: 'default' }}>
                  <span className="step-num">{i + 1}</span>
                  <span className="mono" style={{ color: 'var(--ink-1)', flexShrink: 0 }}>
                    {s.action}
                  </span>
                  <span className="row-list__grow mono" style={{ color: 'var(--ink-3)' }}>
                    {s.target}
                  </span>
                  {s.value && <span className="row-list__meta">{s.value}</span>}
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-4)' }}>
              <button type="button" className="btn">
                Export as Pest
              </button>
              <button type="button" className="btn">
                Export as Playwright
              </button>
              <button type="button" className="btn">
                View last video &amp; trace
              </button>
            </div>
          </div>
        </div>

        <p className="v0-banner" data-animate>
          v0 preview — mock tests in contract C6 shape; the element picker, recorder and in-house trace viewer are
          TST-M2…M5.
        </p>
      </div>
    </div>
  );
};

export default TestPage;
