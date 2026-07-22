import { useEffect, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { useEntrance } from '../lib/anim';
import { SeverityPill } from '../components/StatusPill';
import ScreenState from '../components/ScreenState';
import { api } from '../api/client';
import { useProject } from '../state/ProjectContext';
import { loadEditorSettings, openInIde } from '../types';
import type { DiagnosticFinding, AnalyserStatuses } from '../api/client';

// DX-24: derive per-analyser panel metadata from API-supplied analyser statuses.
// No analyser names are hardcoded — the panel titles and empty-state copy come
// from the registry keys the API returns.

function analyserEmptyHint(analysers: AnalyserStatuses): string {
  const entries = Object.entries(analysers);

  if (entries.length === 0) {
    return 'No scan yet. Link or import a program, then Re-scan on Health.';
  }

  // If any analyser reports missing_binary, surface that first.
  const missing = entries.find(([, s]) => s === 'missing_binary');
  if (missing) {
    return `Analyser "${missing[0]}" binary not found on the Maintain API. Run composer/npm install, then Re-scan on Health.`;
  }

  // All clean
  if (entries.every(([, s]) => s === 'clean')) {
    return `All analysers (${entries.map(([k]) => k).join(', ')}) ran and reported no findings. Hit Re-scan on Health to refresh.`;
  }

  return 'No findings in the latest scan. Hit Re-scan on Health to refresh.';
}

const DiagnosePage: React.FC = () => {
  const history = useHistory();
  const ref = useEntrance();
  const { project, errors, analysers, status, errorMessage } = useProject();
  const [active, setActive] = useState<DiagnosticFinding | null>(null);
  const [lines, setLines] = useState<{ line: number; text: string }[]>([]);
  const [popover, setPopover] = useState<{ top: number } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  // DX-24: generic empty hint derived from registry — no "PHPStan" hardcode.
  const diagnoseEmptyHint = analyserEmptyHint(analysers);

  // DX-24: build analyser panel summaries from registry metadata
  const analyserPanels = Object.entries(analysers).map(([id, s]) => ({
    id,
    label: id.charAt(0).toUpperCase() + id.slice(1),
    status: s,
  }));

  useEffect(() => {
    if (errors[0] && !active) setActive(errors[0]);
  }, [errors, active]);

  useEffect(() => {
    if (!project || !active) {
      setLines([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setFileError(null);
        const { data } = await api.file(project.id, active.file);
        if (cancelled) return;
        if (data.binary || data.missingOnDisk || !data.content) {
          setLines([]);
          setFileError(
            data.binary
              ? 'Binary file'
              : data.missingOnDisk
                ? 'Seeded demo file is not on disk — import a real folder to view source.'
                : 'File content unavailable',
          );
          return;
        }
        const start = Math.max(1, active.range.startLine - 5);
        const all = data.content.split(/\r?\n/);
        const slice = all.slice(start - 1, active.range.endLine + 5).map((text, i) => ({
          line: start + i,
          text,
        }));
        setLines(slice);
      } catch (e) {
        if (!cancelled) setFileError(e instanceof Error ? e.message : 'Failed to load file');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project, active]);

  const severityUi = (s: DiagnosticFinding['severity']): 'critical' | 'serious' | 'warning' =>
    s === 'error' ? 'critical' : s === 'warning' ? 'serious' : 'warning';

  return (
    <div className="page">
      <div className="page__inner" ref={ref} style={{ maxWidth: 1320 }}>
        <div data-animate>
          <h1 className="page__title">Diagnose</h1>
          {/* DX-24: subtitle lists actual registered analysers from API metadata */}
          <p className="page__subtitle">
            Evidence-only findings from static analysers
            {analyserPanels.length > 0 && (
              <> ({analyserPanels.map((a) => a.label).join(', ')})</>
            )}
            . Recall is bounded by static analysis — we never invent errors.
          </p>
        </div>

        {/* DX-24: per-analyser status pills driven from registry */}
        {analyserPanels.length > 0 && (
          <div data-animate style={{ display: 'flex', gap: 'var(--sp-2)', marginBottom: 'var(--sp-3)', flexWrap: 'wrap' }}>
            {analyserPanels.map((a) => (
              <span
                key={a.id}
                style={{
                  padding: '2px 10px',
                  borderRadius: 4,
                  fontSize: 12,
                  background: a.status === 'missing_binary'
                    ? 'var(--accent-wash)'
                    : a.status === 'ok'
                      ? 'var(--status-good)'
                      : 'var(--surface-raised)',
                  color: a.status === 'ok' ? 'var(--surface-page)' : 'var(--ink-2)',
                  border: '1px solid var(--line-2)',
                }}
                aria-label={`${a.label}: ${a.status}`}
              >
                {a.label}: {a.status}
              </span>
            ))}
          </div>
        )}

        <ScreenState
          status={status === 'ready' && errors.length === 0 ? 'empty' : status}
          errorMessage={errorMessage}
          emptyHint={diagnoseEmptyHint}
        >
          <div className="split" data-animate>
            <div className="panel">
              <div className="panel__head">
                <h2 className="panel__title">Findings</h2>
                <span className="panel__hint">{errors.length} from latest scan</span>
              </div>
              <div className="row-list">
                {errors.map((c) => (
                  <div
                    key={c.id}
                    className="row-list__row"
                    style={active?.id === c.id ? { background: 'var(--surface-raised)' } : undefined}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      setActive(c);
                      setPopover(null);
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && setActive(c)}
                  >
                    <SeverityPill severity={severityUi(c.severity)} />
                    <div className="row-list__grow">
                      <div>{c.message}</div>
                      <div className="row-list__meta" style={{ marginTop: 2 }}>
                        <button
                          type="button"
                          className="row-list__link"
                          aria-label={`Show ${c.file} in graph explorer`}
                          onClick={(e) => {
                            e.stopPropagation();
                            history.push(
                              `/explore?focus=${encodeURIComponent(c.file)}&errorId=${encodeURIComponent(c.id)}`,
                            );
                          }}
                        >
                          {c.file}:{c.range.startLine}
                        </button>
                        {' \xb7 '}{c.kind} \xb7 {c.ruleId} \xb7 {c.source}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="panel" style={{ position: 'relative' }}>
              {active ? (
                <>
                  <div className="panel__head">
                    <h2 className="panel__title mono" style={{ textTransform: 'none', letterSpacing: 0 }}>
                      {active.file}
                    </h2>
                    <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
                      <button
                        type="button"
                        className="btn"
                        aria-label="Show this file in the graph explorer"
                        onClick={() =>
                          history.push(
                            `/explore?focus=${encodeURIComponent(active.file)}&errorId=${encodeURIComponent(active.id)}`,
                          )
                        }
                      >
                        Show in graph
                      </button>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => openInIde(loadEditorSettings(), active.file, active.range.startLine)}
                      >
                        Open in IDE
                      </button>
                    </div>
                  </div>
                  <p className="page__subtitle" style={{ margin: '0 0 var(--sp-3)' }}>
                    <strong style={{ color: 'var(--ink-1)' }}>{active.kind}</strong> —{' '}
                    {active.explanation ?? active.message}
                  </p>
                  {fileError && <p className="field__hint">{fileError}</p>}
                  <div className="code-pane">
                    {lines.map((row) => {
                      const hl = row.line >= active.range.startLine && row.line <= active.range.endLine;
                      return (
                        <div
                          key={row.line}
                          className={`code-pane__line ${hl ? 'code-pane__line--hl' : ''}`}
                          onMouseEnter={hl ? (e) => setPopover({ top: e.currentTarget.offsetTop - 8 }) : undefined}
                          role={hl ? 'button' : undefined}
                          tabIndex={hl ? 0 : undefined}
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
                      <h4>Upstream</h4>
                      <ul>
                        {(active.upstream.length ? active.upstream : ['—']).map((f) => (
                          <li key={f}>{f}</li>
                        ))}
                      </ul>
                      <h4>Downstream</h4>
                      <ul>
                        {(active.downstream.length ? active.downstream : ['—']).map((f) => (
                          <li key={f}>{f}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              ) : (
                <p className="page__subtitle">Select a finding.</p>
              )}
            </div>
          </div>
        </ScreenState>
      </div>
    </div>
  );
};

export default DiagnosePage;
