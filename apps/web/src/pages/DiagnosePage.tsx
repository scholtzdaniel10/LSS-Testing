import { useEffect, useState } from 'react';
import { useEntrance } from '../lib/anim';
import { SeverityPill } from '../components/StatusPill';
import ScreenState from '../components/ScreenState';
import { api } from '../api/client';
import { useProject } from '../state/ProjectContext';
import { loadEditorSettings, openInIde } from '../types';
import type { DiagnosticFinding } from '../api/client';

const DiagnosePage: React.FC = () => {
  const ref = useEntrance();
  const { project, errors, analysers, status, errorMessage } = useProject();
  const [active, setActive] = useState<DiagnosticFinding | null>(null);
  const [lines, setLines] = useState<{ line: number; text: string }[]>([]);
  const [popover, setPopover] = useState<{ top: number } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const diagnoseEmptyHint = (() => {
    const phpstan = analysers.phpstan;
    if (phpstan === 'missing_binary') {
      return 'PHPStan is not installed on the Maintain API. From apps/api run composer install, then Re-scan on Health. (Optional: to use PHPStan inside your own program, cd to that folder and run composer require --dev phpstan/phpstan — not required for Diagnose.)';
    }
    if (phpstan === 'clean') {
      return 'PHPStan ran and reported no findings (static analysis only). Hit Re-scan on Health to refresh.';
    }
    if (!phpstan) {
      return 'No scan yet. Link or import a program, then Re-scan on Health. PHPStan runs from the Maintain API (apps/api/vendor), not from each program.';
    }
    return 'No findings in the latest scan. Hit Re-scan on Health to refresh.';
  })();

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
          <p className="page__subtitle">
            Evidence-only findings from real analysers (PHPStan). Recall is bounded by static analysis —
            we never invent errors.
          </p>
        </div>

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
                        {c.file}:{c.range.startLine} · {c.kind} · {c.ruleId} · {c.source}
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
                    <button
                      type="button"
                      className="btn"
                      onClick={() => openInIde(loadEditorSettings(), active.file, active.range.startLine)}
                    >
                      Open in IDE
                    </button>
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
                        {(active.upstream.length ? active.upstream : ['—']).map((f) =>