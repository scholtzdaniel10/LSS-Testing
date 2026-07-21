/**
 * Pure report-building and rendering utilities — no browser dependency.
 */

import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ErrorSeverity = 'error' | 'warning' | 'info';

export interface PageError {
  type: 'page-error' | 'console-error' | 'network-failure' | 'broken-link' | 'slow-page' | 'missing-title';
  severity: ErrorSeverity;
  message: string;
  /** Extra detail (e.g. failed URL, stack) */
  detail?: string;
}

export interface PageResult {
  url: string;
  status: number | null;
  loadMs: number;
  errors: PageError[];
}

export interface RunOptions {
  baseUrl: string;
  maxPages: number;
  depth: number;
  timeout: number;
  budget: number;
  concurrency: number;
  out: string;
  exclude?: string;
  /** Raw header strings "Name: value" — redacted in output */
  headers: string[];
  /** Raw cookie strings "name=value" — redacted in output */
  cookies: string[];
}

export interface ReportSummary {
  pagesVisited: number;
  pageErrors: number;
  consoleErrors: number;
  networkFailures: number;
  brokenLinks: number;
  slowPages: number;
  missingTitles: number;
  totalErrorSeverityFindings: number;
}

export interface SmokeReport {
  runId: string;
  startedAt: string;
  finishedAt: string;
  baseUrl: string;
  /** Options echo — credentials redacted */
  options: Omit<RunOptions, 'headers' | 'cookies'> & { headers: string[]; cookies: string[] };
  pages: PageResult[];
  summary: ReportSummary;
}

// ---------------------------------------------------------------------------
// Report building
// ---------------------------------------------------------------------------

export function createReport(
  startedAt: Date,
  opts: RunOptions,
  pages: PageResult[],
): SmokeReport {
  const summary = buildSummary(pages);
  return {
    runId: randomUUID(),
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    baseUrl: opts.baseUrl,
    options: redactOptions(opts),
    pages,
    summary,
  };
}

export function buildSummary(pages: PageResult[]): ReportSummary {
  let pageErrors = 0;
  let consoleErrors = 0;
  let networkFailures = 0;
  let brokenLinks = 0;
  let slowPages = 0;
  let missingTitles = 0;
  let totalErrorSeverityFindings = 0;

  for (const page of pages) {
    for (const e of page.errors) {
      if (e.severity === 'error') totalErrorSeverityFindings++;
      switch (e.type) {
        case 'page-error':       pageErrors++;       break;
        case 'console-error':    consoleErrors++;    break;
        case 'network-failure':  networkFailures++;  break;
        case 'broken-link':      brokenLinks++;      break;
        case 'slow-page':        slowPages++;        break;
        case 'missing-title':    missingTitles++;    break;
      }
    }
  }

  return {
    pagesVisited: pages.length,
    pageErrors,
    consoleErrors,
    networkFailures,
    brokenLinks,
    slowPages,
    missingTitles,
    totalErrorSeverityFindings,
  };
}

/**
 * Redact credentials from options before persisting/echoing.
 * Replaces every header value with "***REDACTED***" and every cookie with "***REDACTED***".
 */
export function redactOptions(
  opts: RunOptions,
): Omit<RunOptions, 'headers' | 'cookies'> & { headers: string[]; cookies: string[] } {
  const { headers, cookies, ...rest } = opts;
  return {
    ...rest,
    headers: headers.map(() => '***REDACTED***'),
    cookies: cookies.map(() => '***REDACTED***'),
  };
}

// ---------------------------------------------------------------------------
// HTML report rendering
// ---------------------------------------------------------------------------

export function renderHtml(report: SmokeReport): string {
  const s = report.summary;

  const statusBadge = s.totalErrorSeverityFindings === 0
    ? '<span class="badge ok">PASS</span>'
    : `<span class="badge fail">FAIL (${s.totalErrorSeverityFindings} error-severity findings)</span>`;

  const summaryRows = [
    ['Pages visited', s.pagesVisited],
    ['Page errors', s.pageErrors],
    ['Console errors', s.consoleErrors],
    ['Network failures', s.networkFailures],
    ['Broken internal links', s.brokenLinks],
    ['Slow pages', s.slowPages],
    ['Missing titles', s.missingTitles],
  ]
    .map(([label, val]) => `<tr><td>${label}</td><td>${val}</td></tr>`)
    .join('\n');

  // Worst offenders: pages with most errors, top 10
  const worst = [...report.pages]
    .filter(p => p.errors.length > 0)
    .sort((a, b) => b.errors.length - a.errors.length)
    .slice(0, 10);

  const worstRows = worst.length === 0
    ? '<tr><td colspan="3" class="none">No findings</td></tr>'
    : worst.map(p => {
        const errorList = p.errors
          .map(e => `<li class="e-${e.type}">[${e.type}] ${escHtml(e.message)}${e.detail ? ' — ' + escHtml(e.detail) : ''}</li>`)
          .join('');
        return `<tr>
          <td><a href="${escHtml(p.url)}" target="_blank">${escHtml(p.url)}</a></td>
          <td>${p.loadMs}ms</td>
          <td><ul>${errorList}</ul></td>
        </tr>`;
      }).join('\n');

  const allPageRows = report.pages.map(p => {
    const cls = p.errors.some(e => e.severity === 'error') ? 'row-error' : p.errors.length > 0 ? 'row-warn' : '';
    const errSummary = p.errors.length === 0 ? '' : p.errors.map(e => escHtml(e.message)).join('; ');
    return `<tr class="${cls}">
      <td><a href="${escHtml(p.url)}" target="_blank">${escHtml(p.url)}</a></td>
      <td>${p.status ?? '—'}</td>
      <td>${p.loadMs}</td>
      <td>${p.errors.length}</td>
      <td class="err-cell">${errSummary}</td>
    </tr>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Smoke Report — ${escHtml(report.baseUrl)}</title>
<style>
  :root {
    --bg: #f8f9fa; --surface: #fff; --border: #dee2e6;
    --text: #212529; --muted: #6c757d;
    --ok: #198754; --fail: #dc3545; --warn: #ffc107;
    --row-error: #fff5f5; --row-warn: #fffbea;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, sans-serif; background: var(--bg); color: var(--text); font-size: 14px; }
  header { background: #1a1a2e; color: #fff; padding: 1rem 1.5rem; }
  header h1 { font-size: 1.2rem; font-weight: 600; }
  header p { color: #adb5bd; font-size: 0.85rem; margin-top: 0.25rem; }
  main { max-width: 1200px; margin: 1.5rem auto; padding: 0 1rem; }
  section { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 1rem; margin-bottom: 1.25rem; }
  h2 { font-size: 1rem; margin-bottom: 0.75rem; }
  .badge { display: inline-block; padding: 0.2em 0.6em; border-radius: 4px; font-weight: 700; font-size: 0.9rem; }
  .badge.ok { background: var(--ok); color: #fff; }
  .badge.fail { background: var(--fail); color: #fff; }
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  th, td { padding: 0.4rem 0.6rem; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; }
  th { background: var(--bg); font-weight: 600; }
  .row-error { background: var(--row-error); }
  .row-warn  { background: var(--row-warn); }
  td a { color: #0d6efd; text-decoration: none; word-break: break-all; }
  td a:hover { text-decoration: underline; }
  ul { list-style: disc; padding-left: 1.2em; }
  .none { color: var(--muted); font-style: italic; }
  .err-cell { color: var(--fail); font-size: 0.8rem; word-break: break-word; }
  .meta { font-size: 0.8rem; color: var(--muted); }
</style>
</head>
<body>
<header>
  <h1>Smoke Report — ${escHtml(report.baseUrl)}</h1>
  <p>${escHtml(report.startedAt)} &nbsp;|&nbsp; run ${escHtml(report.runId)}</p>
</header>
<main>
  <section>
    <h2>Status &nbsp; ${statusBadge}</h2>
    <table>
      <tbody>${summaryRows}</tbody>
    </table>
  </section>

  <section>
    <h2>Worst offenders (top 10 by finding count)</h2>
    <table>
      <thead><tr><th>URL</th><th>Load</th><th>Findings</th></tr></thead>
      <tbody>${worstRows}</tbody>
    </table>
  </section>

  <section>
    <h2>All pages (${report.pages.length})</h2>
    <table>
      <thead><tr><th>URL</th><th>Status</th><th>Load (ms)</th><th>Findings</th><th>Detail</th></tr></thead>
      <tbody>${allPageRows}</tbody>
    </table>
  </section>

  <section>
    <h2>Run options</h2>
    <pre class="meta">${escHtml(JSON.stringify(report.options, null, 2))}</pre>
  </section>
</main>
</body>
</html>`;
}

function escHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
