/**
 * DX-25: unified ignore rules.
 *
 * The canonical list lives in apps/api/config/sandbox.php.
 * The web fetches it from GET /api/v1/ignore-rules so both sides stay in sync.
 * The local IGNORE_DIRS constant is kept as a compile-time fallback for
 * offline / pre-token use (e.g. ImportDropzone before the API is reachable).
 *
 * Per-stack overlays are merged in when the active project's UsageReport
 * reveals a known framework (e.g. codeigniter-3 → add cache/ + logs/).
 */

/** Fallback dirs mirroring config/sandbox.php — only used when API is unreachable. */
export const IGNORE_DIRS = [
  'node_modules',
  'vendor',
  'dist',
  '.git',
  '.angular',
  'build',
  'coverage',
  '.next',
  'out',
  'tmp',
  'temp',
  '__pycache__',
  'playwright-report',
  'test-results',
] as const;

export type IgnoreStats = {
  kept: number;
  skipped: number;
  skippedByRule: Record<string, number>;
};

/** Shape returned by GET /api/v1/ignore-rules (DX-25). */
export type IgnoreRulesPayload = {
  dirs: string[];
  stackOverlays: Record<string, string[]>;
};

/** In-memory cache so the fetch only runs once per session. */
let cachedPayload: IgnoreRulesPayload | null = null;

/**
 * Fetch the server-side ignore rules and cache them.
 * Falls back to IGNORE_DIRS when the API is unreachable.
 */
export async function fetchIgnoreRules(): Promise<IgnoreRulesPayload> {
  if (cachedPayload) return cachedPayload;

  try {
    const res = await fetch('/api/v1/ignore-rules', { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { data: IgnoreRulesPayload };
    cachedPayload = body.data;
    return cachedPayload;
  } catch {
    // Offline or pre-token: use compile-time fallback
    return { dirs: [...IGNORE_DIRS], stackOverlays: {} };
  }
}

/**
 * Resolve the effective ignore dir list for a given stack.
 * Pass the framework strings from the UsageReport to get per-stack additions.
 */
export function resolveIgnoreDirs(payload: IgnoreRulesPayload, frameworks: string[] = []): string[] {
  const base = [...payload.dirs];
  for (const fw of frameworks) {
    const overlay = payload.stackOverlays[fw] ?? [];
    for (const dir of overlay) {
      if (!base.includes(dir)) base.push(dir);
    }
  }
  return base;
}

export function shouldIgnorePath(relativePath: string, dirs: readonly string[] = IGNORE_DIRS): string | null {
  const normalized = relativePath.replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  for (const segment of segments) {
    if ((dirs as readonly string[]).includes(segment)) {
      return segment;
    }
  }
  return null;
}

export function emptyIgnoreStats(): IgnoreStats {
  return { kept: 0, skipped: 0, skippedByRule: {} };
}

export function recordSkip(stats: IgnoreStats, rule: string): void {
  stats.skipped += 1;
  stats.skippedByRule[rule] = (stats.skippedByRule[rule] ?? 0) + 1;
}
