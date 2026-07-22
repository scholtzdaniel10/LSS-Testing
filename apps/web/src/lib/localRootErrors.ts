/**
 * DSK-7: pure helper to detect the "not under allowed root" error message
 * returned by the API when a link-local attempt is blocked.
 * Tested in localRootErrors.test.ts.
 */
export function isNotUnderAllowedRootError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('allowed root') || lower.includes('add the folder as an allowed root');
}
