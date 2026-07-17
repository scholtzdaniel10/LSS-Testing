import { useState } from 'react';
import { useEntrance } from '../lib/anim';
import { chains, codeSnippet, highlightedLines, type ErrorChain } from '../mock/data';
import { SeverityPill } from '../components/StatusPill';

const DiagnosePage: React.FC = () => {
  const ref = useEntrance();
  const [active, setActive] = useState<ErrorChain>(chains[0]);
  const [popover, setPopover] = useState<{ top: number } | null>(null);

  return (
    <div className="page">
      <div className="page__inner" ref={ref} style={{ maxWidth: 1320 }}>
        <div data-animate>
          <h1 className="page__title">Diagnose</h1>
          <p className="page__subtitle">
            Errors as chains: root cause first, blast radius mapped through the dependency graph.
          </p>
        </div>

        <div className="split" data-animate>
          <div className="panel">
            <div className="panel__head">
              <h2 className="panel__title">Error chains</h2>
              <span className="panel__hint">root cause first</span>
            </div>
            <div className="row-list">
              {chains.map((c) => (
                <div
                  key={c.id}
                  className="row-list__row"
                  style={active.id === c.id ? { background: 'var(--surface-raised)' } : undefined}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setActive(c);
                    setPopover(null);
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && setActive(c)}
                >
                  <SeverityPill severity={c.severity} />
                  <div className="row-list__grow">
                    <div>{c.summary}</div>
                    <div className="row-list__meta" style={{ marginTop: 2 }}>
                      {c.rootFile}:{c.rootLine} · {c.kind} · affects {c.affected.length} files
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="panel" style={{ position: 'relative' }}>
            <div className="panel__head">
              <h2 className="panel__title mono" style={{ textTransform: 'none', letterSpacing: 0 }}>
                {active.rootFile}
              </h2>
              <button type="button" className="btn">
                Open in IDE
              </button>
            </div>

            <p className="page__subtitle" style={{ margin: '0 0 var(--sp-3)' }}>
              <strong style={{ color: 'var(--ink-1)' }}>{active.kind}</strong> — {active.explanation}
            </p>

            <div className="code-pane">
              {codeSnippet.map((row) => {
                const hl = active.id === 'chain-1' && highlightedLines.includes(row.line);
                return (
                  <div
                    key={row.line}
                    className={`code-pane__line ${hl ? 'code-pane__line--hl' : ''}`}
                    onMouseEnter={hl ? (e) => setPopover({ top: e.currentTarget.offsetTop - 8 }) : undefined}
                    role={hl ? 'button' : undefined}
                    tabIndex={hl ? 0 : undefined}
                    aria-label={hl ? 'Highlighted block: show upstream and downstream impact' : undefined}
                  >
                    <span className="code-pane__num">{row.line}</span>
                    <span>{row.text || ' '}</span>
                  </div>
                );
              })}
            </div>

            {popover && (
              <div
                className="chain-popover"
                style={{ right: 24, top: popover.top }}
                onMouseLeave={() => setPopover(null)}
              >
                <h4>Upstream — possible causes</h4>
                <ul>
                  {active.upstream.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
                <h4>Downstream — breaks because of this</h4>
                <ul>
                  {active.affected.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
                <span className="panel__hint">click a file to walk the chain (DX-13)</span>
              </div>
            )}
          </div>
        </div>

        <p className="v0-banner" data-animate>
          v0 preview — two mock chains; real analyser adapters and the impact resolver are DX-M1…M3.
        </p>
      </div>
    </div>
  );
};

export default DiagnosePage;
