#!/usr/bin/env node
/**
 * lss-smoke — smoke-crawl CLI entry point.
 * Arg parsing via node:util parseArgs; no extra dependencies.
 */

import { parseArgs } from 'node:util';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { crawl } from './crawler.js';
import { createReport, renderHtml } from './report.js';
import type { RunOptions } from './report.js';

// ---------------------------------------------------------------------------
// ANSI colour helpers
// ---------------------------------------------------------------------------
const RED     = (s: string) => `\x1b[31m${s}\x1b[0m`;
const YELLOW  = (s: string) => `\x1b[33m${s}\x1b[0m`;
const GREEN   = (s: string) => `\x1b[32m${s}\x1b[0m`;
const BOLD    = (s: string) => `\x1b[1m${s}\x1b[0m`;
const DIM     = (s: string) => `\x1b[2m${s}\x1b[0m`;
const CYAN    = (s: string) => `\x1b[36m${s}\x1b[0m`;

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------
const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    'max-pages':   { type: 'string',  default: '50' },
    depth:         { type: 'string',  default: '3' },
    timeout:       { type: 'string',  default: '15000' },
    budget:        { type: 'string',  default: '3000' },
    concurrency:   { type: 'string',  default: '4' },
    out:           { type: 'string',  default: 'smoke-report' },
    exclude:       { type: 'string' },
    header:        { type: 'string',  multiple: true },
    cookie:        { type: 'string',  multiple: true },
    help:          { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help || positionals.length === 0) {
  console.log(`
${BOLD('lss-smoke')} <baseUrl> [options]

${BOLD('OPTIONS')}
  --max-pages <n>       Max pages to crawl           (default: 50)
  --depth <n>           Max BFS depth                (default: 3)
  --timeout <ms>        Per-page navigation timeout  (default: 15000)
  --budget <ms>         Slow-page threshold          (default: 3000)
  --concurrency <n>     Parallel page contexts       (default: 4)
  --out <path>          Report path (no extension)   (default: smoke-report)
  --exclude <regex>     Skip URLs matching pattern
  --header "Name: v"    Extra request header (repeatable)
  --cookie "name=val"   Cookie to inject (repeatable)
  -h, --help            Show this help

${BOLD('EXIT CODES')}
  0  No error-severity findings
  1  One or more error-severity findings
  2  Fatal error (bad args, browser launch failure)

${BOLD('OUTPUT')}
  <out>.json   Machine-readable report (stable schema)
  <out>.html   Self-contained HTML report (double-click to open)
`);
  process.exit(0);
}

const baseUrl = positionals[0];
if (!baseUrl) {
  console.error(RED('Error: baseUrl is required'));
  process.exit(2);
}

// Validate baseUrl
try { new URL(baseUrl); } catch {
  console.error(RED(`Error: invalid baseUrl "${baseUrl}"`));
  process.exit(2);
}

function parseIntOpt(name: string, raw: string | undefined, def: number): number {
  if (raw === undefined) return def;
  const n = parseInt(raw, 10);
  if (isNaN(n) || n <= 0) {
    console.error(RED(`Error: --${name} must be a positive integer, got "${raw}"`));
    process.exit(2);
  }
  return n;
}

const opts: RunOptions = {
  baseUrl,
  maxPages:    parseIntOpt('max-pages',   values['max-pages'],  50),
  depth:       parseIntOpt('depth',       values['depth'],       3),
  timeout:     parseIntOpt('timeout',     values['timeout'],  15000),
  budget:      parseIntOpt('budget',      values['budget'],   3000),
  concurrency: parseIntOpt('concurrency', values['concurrency'], 4),
  out:         values['out'] ?? 'smoke-report',
  exclude:     values['exclude'],
  headers:     Array.isArray(values['header']) ? values['header'] : values['header'] ? [values['header']] : [],
  cookies:     Array.isArray(values['cookie']) ? values['cookie'] : values['cookie'] ? [values['cookie']] : [],
};

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
console.log(BOLD('\nlss-smoke') + CYAN(` — ${baseUrl}`));
console.log(DIM(`max-pages=${opts.maxPages}  depth=${opts.depth}  timeout=${opts.timeout}ms  budget=${opts.budget}ms  concurrency=${opts.concurrency}\n`));

const startedAt = new Date();
let exitCode = 0;

(async () => {
  try {
    const results = await crawl(opts, (evt) => {
      const statusStr = evt.status != null
        ? evt.status >= 400 ? RED(String(evt.status)) : String(evt.status)
        : DIM('---');
      const loadStr = evt.loadMs > opts.budget
        ? YELLOW(`${evt.loadMs}ms`)
        : `${evt.loadMs}ms`;
      const errStr = evt.errorCount > 0
        ? RED(` [${evt.errorCount} finding${evt.errorCount === 1 ? '' : 's'}]`)
        : '';
      console.log(`  ${DIM('depth=' + evt.depth)} ${statusStr}  ${loadStr}  ${evt.url}${errStr}`);
    });

    const report = createReport(startedAt, opts, results);

    // Write JSON
    const jsonPath = resolve(opts.out + '.json');
    writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');

    // Write HTML
    const htmlPath = resolve(opts.out + '.html');
    writeFileSync(htmlPath, renderHtml(report), 'utf8');

    // ---------------------------------------------------------------------------
    // Console summary
    // ---------------------------------------------------------------------------
    const s = report.summary;
    console.log('\n' + BOLD('─── Summary ───────────────────────────────'));
    console.log(`  Pages crawled:         ${s.pagesVisited}`);
    console.log(`  Page errors:           ${s.pageErrors > 0 ? RED(String(s.pageErrors)) : String(s.pageErrors)}`);
    console.log(`  Console errors:        ${s.consoleErrors > 0 ? RED(String(s.consoleErrors)) : String(s.consoleErrors)}`);
    console.log(`  Network failures:      ${s.networkFailures > 0 ? RED(String(s.networkFailures)) : String(s.networkFailures)}`);
    console.log(`  Broken internal links: ${s.brokenLinks > 0 ? RED(String(s.brokenLinks)) : String(s.brokenLinks)}`);
    console.log(`  Slow pages:            ${s.slowPages > 0 ? YELLOW(String(s.slowPages)) : String(s.slowPages)}`);
    console.log(`  Missing titles:        ${s.missingTitles > 0 ? YELLOW(String(s.missingTitles)) : String(s.missingTitles)}`);

    if (s.totalErrorSeverityFindings > 0) {
      console.log('\n' + RED(BOLD(`  FAIL — ${s.totalErrorSeverityFindings} error-severity finding(s)`)));

      // Worst offenders
      const worst = [...results]
        .filter(p => p.errors.some(e => e.severity === 'error'))
        .sort((a, b) => b.errors.filter(e => e.severity === 'error').length - a.errors.filter(e => e.severity === 'error').length)
        .slice(0, 5);

      if (worst.length > 0) {
        console.log(BOLD('\n  Top offenders:'));
        for (const p of worst) {
          const errCount = p.errors.filter(e => e.severity === 'error').length;
          console.log(`    ${RED('✖')} ${p.url} ${DIM(`(${errCount} errors)`)}`);
          for (const e of p.errors.filter(e => e.severity === 'error').slice(0, 3)) {
            console.log(`      ${DIM('·')} [${e.type}] ${e.message.slice(0, 120)}`);
          }
        }
      }

      exitCode = 1;
    } else {
      console.log('\n' + GREEN(BOLD('  PASS — no error-severity findings')));
    }

    console.log(`\n  JSON: ${jsonPath}`);
    console.log(`  HTML: ${htmlPath}\n`);

  } catch (err) {
    console.error(RED('\nFatal: ') + (err instanceof Error ? err.message : String(err)));
    if (err instanceof Error && err.stack) {
      console.error(DIM(err.stack));
    }
    exitCode = 2;
  }

  process.exit(exitCode);
})();
