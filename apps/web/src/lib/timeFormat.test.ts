import { describe, expect, it, vi, afterEach } from 'vitest';
import { relativeTime } from './timeFormat';

describe('relativeTime', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "never" for null', () => {
    expect(relativeTime(null)).toBe('never');
  });

  it('returns "never" for undefined', () => {
    expect(relativeTime(undefined)).toBe('never');
  });

  it('returns "just now" for < 5s', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-21T12:00:04Z'));
    expect(relativeTime('2026-07-21T12:00:00Z')).toBe('just now');
  });

  it('returns seconds for < 60s', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-21T12:00:30Z'));
    expect(relativeTime('2026-07-21T12:00:00Z')).toBe('30s ago');
  });

  it('returns minutes for < 60m', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-21T12:45:00Z'));
    expect(relativeTime('2026-07-21T12:00:00Z')).toBe('45m ago');
  });

  it('returns hours for < 24h', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-21T15:00:00Z'));
    expect(relativeTime('2026-07-21T12:00:00Z')).toBe('3h ago');
  });

  it('returns days for < 30d', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-28T12:00:00Z'));
    expect(relativeTime('2026-07-21T12:00:00Z')).toBe('7d ago');
  });

  it('returns months for < 12mo', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-21T12:00:00Z'));
    expect(relativeTime('2026-07-21T12:00:00Z')).toBe('3mo ago');
  });

  it('returns years for >= 12mo', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2027-08-21T12:00:00Z'));
    expect(relativeTime('2026-07-21T12:00:00Z')).toBe('1y ago');
  });

  it('returns "invalid date" for a non-ISO string', () => {
    expect(relativeTime('not-a-date')).toBe('invalid date');
  });
});
