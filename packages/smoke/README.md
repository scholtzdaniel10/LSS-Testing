# @lss/smoke — smoke-crawl CLI

Lightweight, zero-cost smoke-testing tool for live web apps. BFS-crawls same-origin pages using Playwright/Chromium (**navigate only — no clicks, no form fills, no submissions**), reports problems in the console and as JSON + HTML reports.

## Install

```sh
# From repo root or packages/smoke
npm install
npx playwright install chromium
```

## Usage

```sh
# Basic crawl
npx lss-smoke https://staging.example.com

# Custom depth and page limit
npx lss-smoke https://staging.example.com --depth 5 --max-pages 200

# Write reports to a specific path
npx lss-smoke https://staging.example.com --out reports/smoke-2026-07-21

# Exclude URLs matching a pattern
npx lss-smoke https://staging.example.com --exclude "/admin|/debug"

# Pass auth headers (credentials stay in memory, redacted from reports)
npx lss-smoke https://staging.example.com --header "Authorization: Bearer <token>"

# Pass cookies
npx lss-smoke https://staging.example.com --cookie "session=abc123"

# Combine options
npx lss-smoke https://staging.example.com \
  --max-pages 100 \
  --depth 4 \
  --budget 5000 \
  --concurrency 6 \
  --header "Authorization: Bearer <token>" \
  --out reports/run-1
```

## Flags

| Flag | Default | Description |
|---|---|---|
| `--max-pages <n>` | 50 | Maximum pages to crawl |
| `--depth <n>` | 3 | Maximum BFS depth |
| `--timeout <ms>` | 15000 | Per-page navigation timeout |
| `--budget <ms>` | 3000 | Slow-page threshold (warning, not error) |
| `--concurrency <n>` | 4 | Parallel page contexts (single browser) |
| `--out <path>` | `smoke-report` | Output path prefix (no extension) |
| `--exclude <regex>` | — | Skip URLs matching this regex |
| `--header "Name: v"` | — | Extra request header (repeatable) |
| `--cookie "n=v"` | — | Cookie to inject (repeatable) |
| `-h, --help` | — | Show help |

## What it checks

| Finding | Severity | Description |
|---|---|---|
| **Page errors** | error | Uncaught JS exceptions (`pageerror` event) |
| **Console errors** | error | `console.error(...)` calls |
| **Network failures** | error | HTTP 4xx/5xx responses or request failures |
| **Broken internal links** | error | Internal `<a>` hrefs that return 404 (HEAD probe) |
| **Slow pages** | warning | Load time exceeds `--budget` |
| **Missing titles** | warning | Page has no `<title>` element |

## Exit codes

| Code | Meaning |
|---|---|
| 0 | No error-severity findings |
| 1 | One or more error-severity findings |
| 2 | Fatal error (bad arguments, browser launch failure) |

Exit code 1 makes the tool suitable as a CI gate.

## Output files

Two report files are written after each run:

- **`<out>.json`** — machine-readable report with stable schema (runId, startedAt, baseUrl, options [credentials redacted], pages[], summary totals)
- **`<out>.html`** — self-contained HTML report with inline CSS (no CDN); double-click to open in any browser

## Security

- **Navigate-only**: the crawler never clicks buttons, fills forms, or submits anything.
- **Credentials stay in memory**: `--header` and `--cookie` values are applied to the browser context at runtime and are redacted (`***REDACTED***`) in both JSON and HTML reports.
- **Same-origin only**: links to external domains are never followed.
- **No target-code execution**: the target URL is the only execution surface; no app code runs in this process.
