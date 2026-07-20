/** IG-17 client-side ignore directory names (mirrored in apps/api/config/sandbox.php). */
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

export function shouldIgnorePath(relativePath: string): string | null {
  const normalized = relativePath.replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  for (const segment of segments) {
    if ((IGNORE_DIRS as readonly string[]).includes(segment)) {
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
