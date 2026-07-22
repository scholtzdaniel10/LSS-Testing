import { useEffect, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { useEntrance } from '../lib/anim';
import { SeverityPill } from '../components/StatusPill';
import ScreenState from '../components/ScreenState';
import { api } from '../api/client';
import { useProject } from '../state/ProjectContext';
import { loadEditorSettings, openInIde } from '../types';
import { findingForFile, groupByChain } from '../lib/chainModel';
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
  const { project, errors, analysers, chains, status, errorMessage } = useProject();
  const [active, setActive] = useState<DiagnosticFinding | null>(null);
  const [lines, setLines] = useState<{ line: number; text: string }[]>([]);
  const [popover, setPopover] = useState<{ top: number } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [expandedChains, setExpandedChains] = useState<Set<string>>(new Set());

  // DX-24: generic empty hint derived from registry — no "PHPStan" hardcode.
  const diagnoseEmptyHint = analyserEmptyHint(analysers);

  // DX-11: chain list view — grouped by chain (root cause first), unchained after.
  const { chainGroups, unchained } = groupByChain(errors, chains);
  const activeChain = active
    ? chainGroups.find((g) => g.members.some((m) => m.id === active.id))
    : undefined;

  const toggleChain = (chainId: string) =>
    setExpandedChains((prev) => {
      const next = new Set(prev);
      if (next.has(chainId)) next.delete(chainId);
      else next.add(chainId);
      return next;
    });

  // DX-13 chain walking: navigate the pane to another finding without leaving it.
  const walkTo = (finding: DiagnosticFinding) => {
    setActive(finding);
    setPopover(null);
  };

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

  const renderRow = (
    c: DiagnosticFinding,
    opts: { badge?: string; indent?: boolean; trailing?: React.ReactNode } = {},
  ) => (
    <div
      key={c.id}
      className="row-list__row"
      style={{
        ...(active?.id === c.id ? { background: 'var(--surface-raised)' } : undefined),
        ...(opts.indent ? { paddingLeft: 'var(--sp-4)' } : undefined),
      }}
      role="button"
      tabIndex={0}
      onClick={() => walkTo(c)}
      onKeyDown={(e) => e.key === 'Enter' && setActive(c)}
    >
      <SeverityPill severity={severityUi(c.severity)} />
      <div className="row-list__grow">
        <div>
          {opts.badge && (
            <span
              style={{
                marginRight: 'var(--sp-2)',
                padding: '1px 8px',
                borderRadius: 4,
                fontSize: 11,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                background: 'var(--accent-wash)',
                color: 'var(--ink-1)',
                border: '1px solid var(--line-2)',
              }}
            >
              {opts.badge}
            </span>
          )}
          {c.message}
        </div>
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
          {' · '}{c.kind}{' · '}{c.ruleId}{' · '}{c.source}
        </div>
      </div>
      {opts.trailing}
    </div>
  );

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
                <span className="panel__hint">
                  {errors.length} from latest scan
                  {chainGroups.length > 0 && <>{' · '}{chainGroups.length} chain{chainGroups.length > 1 ? 's' : ''}</>}
                </span>
              </div>
              <div className="row-list">
                {/* DX-11: chains first — root cause leads, members expand below it */}
                {chainGroups.map((group) => {
                  const expanded = expandedChains.has(group.chainId);
                  const [rootRow, ...rest] = group.members;
                  return (
                    <div key={group.chainId} role="group" aria-label={`Error chain of ${group.members.length}`}>
                      {renderRow(rootRow, {
                        badge: 'root cause',
                        trailing: rest.length > 0 && (
                          <button
                            type="button"
                            className="row-list__link"
                            aria-expanded={expanded}
                            aria-label={`${expanded ? 'Collapse' : 'Expand'} chain of ${group.members.length} errors`}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleChain(group.chainId);
                            }}
                          >
                            {expanded ? '▾' : '▸'} {rest.length} linked
                          </button>
                        ),
                      })}
                      {expanded && rest.map((m) => renderRow(m, { indent: true }))}
                    </div>
                  );
                })}
                {unchained.map((c) => renderRow(c))}
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
                      role="dialog"
                      aria-label="Impact and chain details"
                    >
                      {/* DX-13: kind + explanation header */}
                      <h4>{active.kind}</h4>
                      <p style={{ margin: '0 0 var(--sp-2)', fontSize: 12, color: 'var(--ink-2)' }}>
                        {active.explanation ?? active.message}
                      </p>
                      <h4>Upstream</h4>
                      <ul>
                        {active.upstream.length === 0 && <li>—</li>}
                        {active.upstream.map((f) => {
                          const target = findingForFile(f, errors, activeChain?.members ?? []);
                          return (
                            <li key={f}>
                              {target ? (
                                <button
                                  type="button"
                                  className="row-list__link"
                                  aria-label={`Go to error in ${f}`}
                                  onClick={() => walkTo(target)}
                                >
                                  {f}
                                </button>
                              ) : (
                                f
                              )}
                            </li>
                          );
                        })}
                      </ul>
                      <h4>Downstream</h4>
                      <ul>
                        {active.downstream.length === 0 && <li>—</li>}
                        {active.downstream.map((f) => {
                          const target = findingForFile(f, errors, activeChain?.members ?? []);
                          return (
                            <li key={f}>
                              {target ? (
                                <button
                                  type="button"
                                  className="row-list__link"
                                  aria-label={`Go to error in ${f}`}
                                  onClick={() => walkTo(target)}
                                >
                                  {f}
                                </button>
                              ) : (
                                f
                              )}
                            </li>
                          );
                        })}
                      </ul>
                      {/* DX-13: chain walking — jump to any member without leaving the pane */}
                      {activeChain && activeChain.members.length > 1 && (
                        <>
                          <h4>Chain ({activeChain.members.length})</h4>
                          <ul>
                            {activeChain.members.map((m) => (
                              <li key={m.id}>
                                {m.id === active.id ? (
                                  <span aria-current="true">{m.file}:{m.range.startLine} (this)</span>
                                ) : (
                                  <button
                                    type="button"
                                    className="row-list__link"
                                    aria-label={`Go to chain error in ${m.file}`}
                                    onClick={() => walkTo(m)}
                                  >
                                    {m.file}:{m.range.startLine}
                                    {activeChain.root?.id === m.id ? ' (root)' : ''}
                                  </button>
                                )}
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
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
