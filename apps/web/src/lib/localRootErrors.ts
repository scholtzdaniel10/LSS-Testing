import { ApiError } from '../api/client';

/**
 * DSK-7: stable machine-readable code returned by the API when a link-local
 * attempt is refused because the path is not under any consented root.
 *
 * Kept in sync with PathNotAllowedException::CODE on the API side.
 */
export const PATH_NOT_ALLOWED_CODE = 'path_not_allowed';

/**
 * Detect the "not under allowed root" API failure.
 *
 * Primary check: the RFC-7807 problem envelope carries an extension
 * `code: "path_not_allowed"`.  We inspect all problems in the envelope
 * because some responses may include multiple.
 *
 * Fallback: legacy servers (pre-DSK-7 patch) returned plain 500s with
 * the message text — we still recognise "allowed root" in the message
 * so a rolling upgrade won't strand old API instances.  Both branches
 * are covered by tests.
 */
export function isPathNotAllowedError(err: unknown): boolean {
  if (err instanceof ApiError) {
    const problems = err.body?.errors ?? [];
    if (problems.some((p) => p.code === PATH_NOT_ALLOWED_CODE)) return true;
    // Fallback path — legacy string-matching, kept behind the primary check.
    return isNotUnderAllowedRootMessage(err.message);
  }
  if (err instanceof Error) return isNotUnderAllowedRootMessage(err.message);
  return false;
}

/** Legacy helper — exported so existing tests and code paths keep working. */
export function isNotUnderAllowedRootMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('allowed root') || lower.includes('add the folder as an allowed root');
}

/** @deprecated Use isPathNotAllowedError. Retained for one release for callers pinned to message-text detection. */
export const isNotUnderAllowedRootError = isNotUnderAllowedRootMessage;
