import { describe, it, expect } from 'vitest';
import { isNotUnderAllowedRootError } from './localRootErrors';

describe('isNotUnderAllowedRootError', () => {
  it('matches the exact API error message', () => {
    expect(
      isNotUnderAllowedRootError(
        'Local path is not under an allowed root. Add the folder as an allowed root first.',
      ),
    ).toBe(true);
  });

  it('matches partial: "allowed root"', () => {
    expect(isNotUnderAllowedRootError('not under an allowed root')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isNotUnderAllowedRootError('NOT UNDER AN ALLOWED ROOT')).toBe(true);
  });

  it('does not match unrelated messages', () => {
    expect(isNotUnderAllowedRootError('Local path linking is disabled on this API.')).toBe(false);
    expect(isNotUnderAllowedRootError('Local source path is not an accessible directory.')).toBe(false);
    expect(isNotUnderAllowedRootError('API unreachable')).toBe(false);
    expect(isNotUnderAllowedRootError('')).toBe(false);
  });
});
