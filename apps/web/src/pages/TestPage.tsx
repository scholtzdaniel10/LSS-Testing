import { useEntrance } from '../lib/anim';
import { useProject } from '../state/ProjectContext';

/**
 * Test composer/runner is out of Iteration 1 (TST-M2…). Keep the screen honest:
 * show target env when configured; no fake suites or dead Run/Record buttons.
 */
const TestPage: React.FC = () => {
  const ref = useEntrance();
  const { targets, project } = useProject();
  const env = targets[0];

  return (
    <div className="page">
      <div className="page__inner" ref={ref} style={{ maxWidth: 760 }}>
        <div data-animate>
          <h1 className="page__title">Test</h1>
          <p className="page__subtitle">
            Pest / Playwright fabrication against the company program&apos;s own URL is planned for a later
            iteration (TST track). Iteration 1 only persists the target environment.
          </p>
        </div>

        <div className="panel" data-animate>
          <div className="panel__head">
            <h2 className="panel__title">Target for future runs</h2>
            <span className="panel__hint">{project?.name ?? 'no project'}</span>
          </div>
          {env ? (
            <>
              <p>
                <span className="mono">{env.name}</span> → <span className="mono">{env.baseUrl}</span>
              </p>
              {env.notes && <p className="field__hint">{env.notes}</p>}
            </>
          ) : (
            <p className="page__subtitle">No target environment yet — configure one in Settings.</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default TestPage;
