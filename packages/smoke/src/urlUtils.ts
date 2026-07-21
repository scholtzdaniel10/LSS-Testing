/**
 * Pure URL-handling utilities — no browser dependency, fully unit-testable.
 */

/** File extensions to skip (downloads, assets, etc.) */
const SKIP_EXTENSIONS = new Set([
  'pdf', 'zip', 'tar', 'gz', 'rar', '7z',
  'exe', 'msi', 'dmg', 'pkg', 'deb', 'rpm',
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'ico', 'bmp', 'tiff', 'avif',
  'mp4', 'webm', 'mov', 'avi', 'mkv', 'mp3', 'ogg', 'wav', 'flac',
  'woff', 'woff2', 'ttf', 'eot',
  'css', 'js', 'mjs', 'map',
  'xml', 'rss', 'atom',
  'csv', 'xls', 'xlsx', 'doc', 'docx', 'ppt', 'pptx',
]);

/**
 * Normalise a URL: resolve relative to base, strip fragment, lowercase scheme+host.
 * Returns null if the URL is unparseable.
 */
export function normalizeUrl(raw: string, base: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(raw, base);
  } catch {
    return null;
  }
  // Strip fragment
  parsed.hash = '';
  // Normalise scheme+host to lowercase (path is case-sensitive on many servers)
  parsed.protocol = parsed.protocol.toLowerCase();
  parsed.hostname = parsed.hostname.toLowerCase();
  return parsed.href;
}

/**
 * Return true when href is same-origin as origin (scheme + host + port must match).
 */
export function isSameOrigin(href: string, origin: string): boolean {
  try {
    const a = new URL(href);
    const b = new URL(origin);
    return a.origin === b.origin;
  } catch {
    return false;
  }
}

/**
 * Return true if the URL should be skipped (non-http scheme, download extension).
 */
export function shouldSkip(href: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(href);
  } catch {
    return true;
  }
  // Skip non-http(s) schemes
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return true;
  }
  // Skip by extension
  const path = parsed.pathname;
  const dot = path.lastIndexOf('.');
  if (dot !== -1) {
    const ext = path.slice(dot + 1).toLowerCase();
    if (SKIP_EXTENSIONS.has(ext)) {
      return true;
    }
  }
  return false;
}

/**
 * Return true if href matches the exclude regex pattern (if provided).
 */
export function matchesExclude(href: string, excludePattern: string | undefined): boolean {
  if (!excludePattern) return false;
  try {
    const re = new RegExp(excludePattern);
    return re.test(href);
  } catch {
    return false;
  }
}

/**
 * Extract all href values from anchor tags in an HTML string.
 * This is a lightweight regex scan — not a full parser. Playwright gives us
 * the DOM so we only need this for testing.
 */
export function extractLinks(html: string): string[] {
  const re = /href=["']([^"']+)["']/gi;
  const links: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    links.push(m[1]);
  }
  return links;
}
