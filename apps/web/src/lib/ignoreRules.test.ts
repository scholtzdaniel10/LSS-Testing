import { describe, expect, it } from 'vitest';
import { shouldIgnorePath, emptyIgnoreStats, recordSkip } from './ignoreRules';

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
});
