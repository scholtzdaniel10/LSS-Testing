import { describe, it, expect } from 'vitest';
import { ApiError } from '../api/client';
import {
  isPathNotAllowedError,
  isNotUnderAllowedRootMessage,
  PATH_NOT_ALLOWED_CODE,
} from './localRootErrors';

function apiErrorWithCode(code: string, message = 'Path not allowed'): ApiError {
  return new ApiError(message, 422, {
    data: null,
    meta: {},
    errors: [{ status: 422, title: 'Path not allowed', detail: message, code }],
  });
}

describe('isPathNotAllowedError (primary — machine-readable code)', () => {
  it('true when problem carries code === path_not_allowed', () => {
    expect(isPathNotAllowedError(apiErrorWithCode(PATH_NOT_ALLOWED_CODE))).toBe(true);
  });

  it('false when a different code is returned', () => {
    expect(isPathNotAllowedError(apiErrorWithCode('some_other_code'))).toBe(false);
  });

  it('false when ApiError has no body/errors', () => {
    expect(isPathNotAllowedError(new ApiError('boom', 500))).toBe(false);
  });
});

describe('isPathNotAllowedError (fallback — legacy message text)', () => {
  it('true when a bare Error message mentions "allowed root"', () => {
    expect(isPathNotAllowedError(new Error('not under an allowed root'))).toBe(true);
  });

  it('false for unrelated errors', () => {
    expect(isPathNotAllowedError(new Error('API unreachable'))).toBe(false);
    expect(isPathNotAllowedError(null)).toBe(false);
    expect(isPathNotAllowedError(undefined)).toBe(false);
    expect(isPathNotAllowedError('a string')).toBe(false);
  });
});

describe('isNotUnderAllowedRootMessage (legacy helper)', () => {
  it('matches the exact API error message', () => {
    expect(
      isNotUnderAllowedRootMessage(
        'Local path is not under an allowed root. Add the folder as an allowed root first.',
      ),
    ).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isNotUnderAllowedRootMessage('NOT UNDER AN ALLOWED ROOT')).toBe(true);
  });

  it('does not match unrelated messages', () => {
    expect(isNotUnderAllowedRootMessage('Local path linking is disabled on this API.')).toBe(false);
    expect(isNotUnderAllowedRootMessage('API unreachable')).toBe(false);
    expect(isNotUnderAllowedRootMessage('')).toBe(false);
  });
});
