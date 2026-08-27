import { describe, expect, it } from 'vitest';
import { assertContract, isValidContract, schemaFor } from './contracts';

const c1 = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  projectId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  name: 'staging',
  baseUrl: 'https://staging.example.test',
};

const c2 = {
  projectId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  takenAt: '2026-08-27T08:00:00+00:00',
  scores: { overall: 40, errors: 20, dependencies: 80, tests: 0, structure: 90 },
  metrics: {
    errorCounts: { error: 2, warning: 1, info: 0 },
    errorChains: 1,
    missingDeps: 1,
    outdatedDeps: 0,
    undeclaredEnvVars: 1,
    testPassRate: 0,
    testsTotal: 0,
    filesAnalysed: 10,
    hotspots: [],
  },
  topIssues: [],
};

const c3 = {
  from: 'app/A.php',
  to: 'app/B.php',
  kind: 'import',
  line: 4,
};

const c4 = {
  uses: { languages: ['php'], frameworks: [], deps: [] },
  needs: { missingDeps: [], envVars: [], services: [] },
};

const c5 = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  source: 'phpstan',
  ruleId: 'return.type',
  kind: 'type-error',
  severity: 'error',
  file: 'app/A.php',
  range: { startLine: 1, startCol: 0, endLine: 1, endCol: 8 },
  message: 'bad return',
};

const c6 = {
  id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  projectId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  targetEnvId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  name: 'loads',
  steps: [
    {
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      action: 'navigate',
      target: { selector: '[data-testid="home"]' },
    },
  ],
};

describe('PLT-9 contract schemas', () => {
  it('imports C1–C6 from packages/schemas (single source)', () => {
    expect(schemaFor('health-snapshot')).toMatchObject({ title: 'Health snapshot (contract C2)' });
    expect(schemaFor('diagnostic-error')).toMatchObject({ title: 'Diagnostic error (contract C5)' });
  });

  it.each([
    ['target-environment', c1],
    ['health-snapshot', c2],
    ['dependency-edge', c3],
    ['usage-report', c4],
    ['diagnostic-error', c5],
    ['test', c6],
  ] as const)('accepts a golden %s document', (contract, document) => {
    expect(isValidContract(contract, document)).toBe(true);
  });

  it('rejects a C3 edge with null line (must omit when unknown)', () => {
    expect(isValidContract('dependency-edge', { ...c3, line: null })).toBe(false);
  });

  it('rejects extra properties', () => {
    expect(() => assertContract('usage-report', { ...c4, extra: true })).toThrow(/usage-report/);
  });
});
