import { describe, expect, it } from 'vitest';
import {
  shouldIgnorePath,
  emptyIgnoreStats,
  recordSkip,
  resolveIgnoreDirs,
  type IgnoreRulesPayload,
} from './ignoreRules';

// ── existing IG-17 tests (unchanged) ─────────────────────────────────────────

describe('IG-17 ignore rules', () => {
  it('skips node_modules and vendor path segments', () => {
    expect(shouldIgnorePath('app/node_modules/x/index.js')).toBe('node_modules');
    expect(shouldIgnorePath('vendor/autoload.php')).toBe('vendor');
    expect(shouldIgnorePath('application/controllers/Welcome.php')).toBeNull();
  });

  it('counts skips by rule', () => {
    const stats = emptyIgnoreStats();
    recordSkip(stats, 'node_modules');
    recordSkip(stats, 'node_modules');
    recordSkip(stats, 'dist');
    expect(stats.skipped).toBe(3);
    expect(stats.skippedByRule.node_modules).toBe(2);
    expect(stats.skippedByRule.dist).toBe(1);
  });

  it('accepts a custom dirs array', () => {
    expect(shouldIgnorePath('cache/foo.txt', ['cache', 'logs'])).toBe('cache');
    expect(shouldIgnorePath('src/bar.ts', ['cache', 'logs'])).toBeNull();
  });

  it('skips .phpunit.cache (IG-27: PHPUnit 10+ cache dir, same class as coverage/test-results)', () => {
    expect(shouldIgnorePath('.phpunit.cache/code-coverage/abc123')).toBe('.phpunit.cache');
    expect(shouldIgnorePath('.phpunit.cache/test-results')).toBe('.phpunit.cache');
  });
});

// ── DX-25: resolveIgnoreDirs merges stack overlays ───────────────────────────

describe('DX-25 resolveIgnoreDirs', () => {
  const payload: IgnoreRulesPayload = {
    dirs: ['node_modules', 'vendor', 'dist'],
    stackOverlays: {
      'codeigniter-3': ['cache', 'logs'],
      laravel: ['bootstrap/cache', 'storage'],
    },
  };

  it('returns base dirs when no frameworks given', () => {
    const dirs = resolveIgnoreDirs(payload);
    expect(dirs).toEqual(['node_modules', 'vendor', 'dist']);
  });

  it('merges CI3 overlay without duplicates', () => {
    const dirs = resolveIgnoreDirs(payload, ['codeigniter-3']);
    expect(dirs).toContain('cache');
    expect(dirs).toContain('logs');
    expect(dirs).toContain('node_modules');
  });

  it('merges laravel overlay', () => {
    const dirs = resolveIgnoreDirs(payload, ['laravel']);
    expect(dirs).toContain('bootstrap/cache');
    expect(dirs).toContain('storage');
  });

  it('merges multiple framework overlays', () => {
    const dirs = resolveIgnoreDirs(payload, ['codeigniter-3', 'laravel']);
    expect(dirs).toContain('cache');
    expect(dirs).toContain('bootstrap/cache');
  });

  it('ignores unknown framework keys gracefully', () => {
    const dirs = resolveIgnoreDirs(payload, ['ruby-on-rails']);
    expect(dirs).toEqual(['node_modules', 'vendor', 'dist']);
  });

  it('does not add duplicates when overlay overlaps base', () => {
    const p: IgnoreRulesPayload = {
      dirs: ['vendor', 'cache'],
      stackOverlays: { 'codeigniter-3': ['cache', 'logs'] },
    };
    const dirs = resolveIgnoreDirs(p, ['codeigniter-3']);
    expect(dirs.filter((d) => d === 'cache')).toHaveLength(1);
  });
});
