import { describe, expect, it } from 'vitest';
import { findingForFile, groupByChain } from './chainModel';
import type { DiagnosticFinding, ErrorChain } from '../api/client';

const finding = (id: string, file: string): DiagnosticFinding => ({
  id,
  source: 'phpstan',
  ruleId: 'return.type',
  kind: 'type-error',
  severity: 'error',
  file,
  range: { startLine: 1, startCol: 1, endLine: 1, endCol: 10 },
  message: `broken in ${file}`,
  explanation: null,
  upstream: [],
  downstream: [],
});

const chain = (chainId: string, rootIds: string[], ids: string[]): ErrorChain => ({
  chainId,
  rootErrorIds: rootIds,
  errorIds: ids,
});

describe('groupByChain — DX-11 grouping mirrors DX-8', () => {
  it('groups chained errors with the root cause first', () => {
    const errors = [finding('e-d', 'd.php'), finding('e-a', 'a.php'), finding('e-b', 'b.php')];
    const { chainGroups, unchained } = groupByChain(errors, [
      chain('ch-1', ['e-a'], ['e-d', 'e-a', 'e-b']),
    ]);

    expect(chainGroups).toHaveLength(1);
    expect(chainGroups[0].root?.id).toBe('e-a');
    expect(chainGroups[0].members.map((m) => m.id)).toEqual(['e-a', 'e-d', 'e-b']);
    expect(unchained).toHaveLength(0);
  });

  it('keeps errors outside any chain in the unchained list', () => {
    const errors = [finding('e-a', 'a.php'), finding('e-x', 'lone.php')];
    const { chainGroups, unchained } = groupByChain(errors, [chain('ch-1', ['e-a'], ['e-a'])]);

    expect(chainGroups).toHaveLength(1);
    expect(unchained.map((e) => e.id)).toEqual(['e-x']);
  });

  it('handles no chains at all (everything unchained)', () => {
    const errors = [finding('e-1', 'a.php'), finding('e-2', 'b.php')];
    const { chainGroups, unchained } = groupByChain(errors, []);

    expect(chainGroups).toHaveLength(0);
    expect(unchained).toHaveLength(2);
  });

  it('drops chain member ids that are not in the error list', () => {
    const errors = [finding('e-a', 'a.php')];
    const { chainGroups } = groupByChain(errors, [chain('ch-1', ['e-a'], ['e-a', 'e-gone'])]);

    expect(chainGroups[0].members.map((m) => m.id)).toEqual(['e-a']);
  });

  it('skips a chain whose members are all missing from the list', () => {
    const errors = [finding('e-a', 'a.php')];
    const { chainGroups, unchained } = groupByChain(errors, [chain('ch-x', ['e-z'], ['e-z'])]);

    expect(chainGroups).toHaveLength(0);
    expect(unchained).toHaveLength(1);
  });

  it('still lists members when the root id is missing', () => {
    const errors = [finding('e-b', 'b.php'), finding('e-c', 'c.php')];
    const { chainGroups } = groupByChain(errors, [chain('ch-1', ['e-gone'], ['e-b', 'e-c'])]);

    expect(chainGroups[0].root).toBeNull();
    expect(chainGroups[0].members.map((m) => m.id)).toEqual(['e-b', 'e-c']);
  });
});

describe('findingForFile — DX-13 chain walking', () => {
  it('prefers a chain member over an unrelated finding on the same file', () => {
    const inChain = finding('e-chain', 'shared.php');
    const outside = finding('e-other', 'shared.php');
    expect(findingForFile('shared.php', [outside, inChain], [inChain])?.id).toBe('e-chain');
  });

  it('falls back to any finding on the file', () => {
    const outside = finding('e-other', 'b.php');
    expect(findingForFile('b.php', [outside], [])?.id).toBe('e-other');
  });

  it('returns null when no finding touches the file', () => {
    expect(findingForFile('clean.php', [finding('e-a', 'a.php')], [])).toBeNull();
  });
});
