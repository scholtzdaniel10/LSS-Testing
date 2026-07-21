import { describe, it, expect } from 'vitest';
import { buildSummary, redactOptions, createReport } from './report.js';
import type { PageResult, RunOptions } from './report.js';

const BASE_OPTS: RunOptions = {
  baseUrl: 'https://example.com',
  maxPages: 50,
  depth: 3,
  timeout: 15000,
  budget: 3000,
  concurrency: 4,
  out: 'smoke-report',
  headers: ['Authorization: Bearer secret-token', 'X-Api-Key: my-key'],
  cookies: ['session=abc123', 'auth=xyz'],
};

const NO_ERROR_PAGE: PageResult = {
  url: 'https://example.com/',
  status: 200,
  loadMs: 500,
  errors: [],
};

const ERROR_PAGE: PageResult = {
  url: 'https://example.com/broken',
  status: 200,
  loadMs: 1200,
  errors: [
    { type: 'page-error',      severity: 'error',   message: 'TypeError: Cannot read property' },
    { type: 'console-error',   severity: 'error',   message: 'Failed to load resource' },
    { type: 'network-failure', severity: 'error',   message: 'HTTP 500 on /api/data' },
    { type: 'broken-link',     severity: 'error',   message: 'Internal link returns 404: /old-page' },
    { type: 'slow-page',       severity: 'warning', message: 'Page load 4500ms exceeds budget 3000ms' },
    { type: 'missing-title',   severity: 'warning', message: 'Page has no <title>' },
  ],
};

const WARN_ONLY_PAGE: PageResult = {
  url: 'https://example.com/slow',
  status: 200,
  loadMs: 4000,
  errors: [
    { type: 'slow-page',     severity: 'warning', message: 'Page load 4000ms exceeds budget' },
    { type: 'missing-title', severity: 'warning', message: 'Page has no <title>' },
  ],
};

describe('buildSummary', () => {
  it('returns all zeros for empty pages array', () => {
    const s = buildSummary([]);
    expect(s.pagesVisited).toBe(0);
    expect(s.pageErrors).toBe(0);
    expect(s.consoleErrors).toBe(0);
    expect(s.networkFailures).toBe(0);
    expect(s.brokenLinks).toBe(0);
    expect(s.slowPages).toBe(0);
    expect(s.missingTitles).toBe(0);
    expect(s.totalErrorSeverityFindings).toBe(0);
  });

  it('counts pages visited correctly', () => {
    const s = buildSummary([NO_ERROR_PAGE, ERROR_PAGE]);
    expect(s.pagesVisited).toBe(2);
  });

  it('counts error types independently', () => {
    const s = buildSummary([ERROR_PAGE]);
    expect(s.pageErrors).toBe(1);
    expect(s.consoleErrors).toBe(1);
    expect(s.networkFailures).toBe(1);
    expect(s.brokenLinks).toBe(1);
    expect(s.slowPages).toBe(1);
    expect(s.missingTitles).toBe(1);
  });

  it('counts only error-severity findings in totalErrorSeverityFindings', () => {
    const s = buildSummary([ERROR_PAGE]);
    // page-error, console-error, network-failure, broken-link = 4 error-severity
    // slow-page and missing-title are warnings
    expect(s.totalErrorSeverityFindings).toBe(4);
  });

  it('warnings do not contribute to totalErrorSeverityFindings', () => {
    const s = buildSummary([WARN_ONLY_PAGE]);
    expect(s.totalErrorSeverityFindings).toBe(0);
    expect(s.slowPages).toBe(1);
    expect(s.missingTitles).toBe(1);
  });

  it('aggregates across multiple pages', () => {
    const s = buildSummary([NO_ERROR_PAGE, ERROR_PAGE, WARN_ONLY_PAGE]);
    expect(s.pagesVisited).toBe(3);
    expect(s.pageErrors).toBe(1);
    expect(s.slowPages).toBe(2); // one from ERROR_PAGE, one from WARN_ONLY_PAGE
    expect(s.missingTitles).toBe(2);
  });
});

describe('redactOptions', () => {
  it('replaces header values with REDACTED', () => {
    const redacted = redactOptions(BASE_OPTS);
    expect(redacted.headers).toHaveLength(2);
    for (const h of redacted.headers) {
      expect(h).toBe('***REDACTED***');
    }
  });

  it('replaces cookie values with REDACTED', () => {
    const redacted = redactOptions(BASE_OPTS);
    expect(redacted.cookies).toHaveLength(2);
    for (const c of redacted.cookies) {
      expect(c).toBe('***REDACTED***');
    }
  });

  it('preserves non-credential fields', () => {
    const redacted = redactOptions(BASE_OPTS);
    expect(redacted.baseUrl).toBe('https://example.com');
    expect(redacted.maxPages).toBe(50);
    expect(redacted.depth).toBe(3);
    expect(redacted.timeout).toBe(15000);
    expect(redacted.budget).toBe(3000);
    expect(redacted.concurrency).toBe(4);
    expect(redacted.out).toBe('smoke-report');
  });

  it('handles empty headers and cookies arrays', () => {
    const opts: RunOptions = { ...BASE_OPTS, headers: [], cookies: [] };
    const redacted = redactOptions(opts);
    expect(redacted.headers).toEqual([]);
    expect(redacted.cookies).toEqual([]);
  });

  it('does not mutate the original options', () => {
    const opts: RunOptions = { ...BASE_OPTS };
    redactOptions(opts);
    expect(opts.headers[0]).toBe('Authorization: Bearer secret-token');
  });
});

describe('createReport', () => {
  it('produces a report with a runId, timestamps and correct pages', () => {
    const start = new Date('2026-07-21T10:00:00Z');
    const report = createReport(start, BASE_OPTS, [NO_ERROR_PAGE]);
    expect(report.runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(report.startedAt).toBe('2026-07-21T10:00:00.000Z');
    expect(report.finishedAt).toBeDefined();
    expect(report.pages).toHaveLength(1);
    expect(report.baseUrl).toBe('https://example.com');
  });

  it('redacts credentials in the options field', () => {
    const start = new Date();
    const report = createReport(start, BASE_OPTS, []);
    for (const h of report.options.headers) {
      expect(h).toBe('***REDACTED***');
    }
    for (const c of report.options.cookies) {
      expect(c).toBe('***REDACTED***');
    }
  });

  it('computes summary correctly', () => {
    const start = new Date();
    const report = createReport(start, BASE_OPTS, [ERROR_PAGE, NO_ERROR_PAGE]);
    expect(report.summary.pagesVisited).toBe(2);
    expect(report.summary.totalErrorSeverityFindings).toBe(4);
  });
});
