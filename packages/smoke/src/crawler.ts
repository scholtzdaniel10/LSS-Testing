/**
 * Browser orchestration — BFS crawler using Playwright/Chromium.
 * Navigate-only: never clicks, fills forms, or submits.
 */

import { chromium } from 'playwright';
import type { Browser, BrowserContext, Cookie } from 'playwright';
import { normalizeUrl, isSameOrigin, shouldSkip, matchesExclude } from './urlUtils.js';
import type { PageResult, PageError, RunOptions } from './report.js';

export interface CrawlProgressEvent {
  type: 'page';
  url: string;
  status: number | null;
  loadMs: number;
  errorCount: number;
  depth: number;
}

export type ProgressCallback = (evt: CrawlProgressEvent) => void;

interface QueueItem {
  url: string;
  depth: number;
}

/** Internal extended type to carry discovered links through the pipeline */
interface PageResultInternal extends PageResult {
  _links?: string[];
}

/**
 * Run the BFS crawl. Returns one PageResult per visited URL.
 * Emits progress events via onProgress (optional).
 */
export async function crawl(
  opts: RunOptions,
  onProgress?: ProgressCallback,
): Promise<PageResult[]> {
  const results: PageResultInternal[] = [];
  const visited = new Set<string>();
  const queue: QueueItem[] = [];

  const startNorm = normalizeUrl(opts.baseUrl, opts.baseUrl);
  if (!startNorm) throw new Error(`Invalid baseUrl: ${opts.baseUrl}`);
  queue.push({ url: startNorm, depth: 0 });
  visited.add(startNorm);

  const browser: Browser = await chromium.launch({ headless: true });

  try {
    // Parse --header flags into HTTP header object
    const extraHeaders: Record<string, string> = {};
    for (const h of opts.headers) {
      const colon = h.indexOf(':');
      if (colon === -1) continue;
      const name = h.slice(0, colon).trim();
      const value = h.slice(colon + 1).trim();
      extraHeaders[name] = value;
    }

    // Parse --cookie flags into Playwright Cookie objects
    const contextCookies: Cookie[] = [];
    for (const c of opts.cookies) {
      const eq = c.indexOf('=');
      if (eq === -1) continue;
      const name = c.slice(0, eq).trim();
      const value = c.slice(eq + 1).trim();
      const originUrl = new URL(startNorm);
      contextCookies.push({
        name,
        value,
        domain: originUrl.hostname,
        path: '/',
        expires: -1,
        httpOnly: false,
        secure: originUrl.protocol === 'https:',
        sameSite: 'Lax',
      });
    }

    // Process in BFS waves, up to concurrency parallel contexts
    while (queue.length > 0 && results.length < opts.maxPages) {
      const batch: QueueItem[] = [];
      while (queue.length > 0 && batch.length < opts.concurrency && results.length + batch.length < opts.maxPages) {
        batch.push(queue.shift()!);
      }

      await Promise.all(batch.map(async (item) => {
        const pageResult = await visitPage(browser, item.url, opts, extraHeaders, contextCookies);
        results.push(pageResult);

        onProgress?.({
          type: 'page',
          url: item.url,
          status: pageResult.status,
          loadMs: pageResult.loadMs,
          errorCount: pageResult.errors.length,
          depth: item.depth,
        });

        // Only follow links if within depth limit
        if (item.depth >= opts.depth) return;

        // Collect links from the page to enqueue
        for (const link of pageResult._links ?? []) {
          const norm = normalizeUrl(link, item.url);
          if (!norm) continue;
          if (visited.has(norm)) continue;
          if (!isSameOrigin(norm, opts.baseUrl)) continue;
          if (shouldSkip(norm)) continue;
          if (matchesExclude(norm, opts.exclude)) continue;
          visited.add(norm);
          queue.push({ url: norm, depth: item.depth + 1 });
        }
      }));
    }
  } finally {
    await browser.close();
  }

  // Strip internal _links field before returning
  return results.map(({ _links: _ignored, ...rest }) => rest as PageResult);
}

async function visitPage(
  browser: Browser,
  url: string,
  opts: RunOptions,
  extraHeaders: Record<string, string>,
  contextCookies: Cookie[],
): Promise<PageResultInternal> {
  const errors: PageError[] = [];
  let status: number | null = null;
  const links: string[] = [];

  const context: BrowserContext = await browser.newContext({
    extraHTTPHeaders: extraHeaders,
  });

  if (contextCookies.length > 0) {
    await context.addCookies(contextCookies);
  }

  const page = await context.newPage();

  // Capture uncaught page errors
  page.on('pageerror', (err) => {
    errors.push({
      type: 'page-error',
      severity: 'error',
      message: err.message,
      detail: err.stack,
    });
  });

  // Capture console errors
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push({
        type: 'console-error',
        severity: 'error',
        message: msg.text(),
      });
    }
  });

  // Capture failed/4xx/5xx network responses
  page.on('response', (response) => {
    const s = response.status();
    if (s >= 400) {
      errors.push({
        type: 'network-failure',
        severity: 'error',
        message: 'HTTP ' + s + ' on ' + response.url(),
        detail: response.url(),
      });
    }
  });

  // Capture request failures (DNS errors, etc.)
  page.on('requestfailed', (request) => {
    const errText = request.failure()?.errorText ?? 'unknown';
    errors.push({
      type: 'network-failure',
      severity: 'error',
      message: 'Request failed: ' + errText + ' on ' + request.url(),
      detail: request.url(),
    });
  });

  const t0 = Date.now();
  let loadMs = 0;

  try {
    const response = await page.goto(url, {
      timeout: opts.timeout,
      waitUntil: 'domcontentloaded',
    });
    loadMs = Date.now() - t0;
    status = response?.status() ?? null;

    // Check missing title
    const title = await page.title();
    if (!title || title.trim() === '') {
      errors.push({
        type: 'missing-title',
        severity: 'warning',
        message: 'Page has no <title>',
      });
    }

    // Flag slow page
    if (loadMs > opts.budget) {
      errors.push({
        type: 'slow-page',
        severity: 'warning',
        message: 'Page load ' + loadMs + 'ms exceeds budget ' + opts.budget + 'ms',
      });
    }

    // Collect same-origin anchor hrefs for BFS queue
    const hrefs: string[] = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a[href]'))
        .map((a) => (a as HTMLAnchorElement).href)
        .filter(Boolean);
    });
    links.push(...hrefs);

    // Check each internal link for 404 by issuing a HEAD request
    const internalLinks = hrefs
      .map(h => normalizeUrl(h, url))
      .filter((n): n is string => n !== null)
      .filter(n => isSameOrigin(n, opts.baseUrl))
      .filter(n => !shouldSkip(n));

    for (const linkUrl of internalLinks) {
      try {
        const apiReq = await context.request.fetch(linkUrl, {
          method: 'HEAD',
          timeout: Math.min(opts.timeout, 5000),
        });
        if (apiReq.status() === 404) {
          errors.push({
            type: 'broken-link',
            severity: 'error',
            message: 'Internal link returns 404: ' + linkUrl,
            detail: linkUrl,
          });
        }
      } catch {
        // Network error on HEAD -- full crawl will catch it
      }
    }

  } catch (err) {
    loadMs = Date.now() - t0;
    const msg = err instanceof Error ? err.message : String(err);
    errors.push({
      type: 'page-error',
      severity: 'error',
      message: 'Navigation failed: ' + msg,
    });
  } finally {
    await page.close();
    await context.close();
  }

  return { url, status, loadMs, errors, _links: links };
}
