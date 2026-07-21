/**
 * Format an ISO-8601 timestamp as a human-readable relative string.
 * Exported as a pure function so it can be unit-tested without DOM.
 */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const now = Date.now();
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'invalid date';
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 30) return `${diffD}d ago`;
  const diffMo = Math.floor(diffD / 30);
  if (diffMo < 12) return `${diffMo}mo ago`;
  return `${Math.floor(diffMo / 12)}y ago`;
}
