import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import type { ErrorObject } from 'ajv';

import targetEnvironmentSchema from '@lss/schemas/target-environment.schema.json';
import healthSnapshotSchema from '@lss/schemas/health-snapshot.schema.json';
import dependencyEdgeSchema from '@lss/schemas/dependency-edge.schema.json';
import usageReportSchema from '@lss/schemas/usage-report.schema.json';
import diagnosticErrorSchema from '@lss/schemas/diagnostic-error.schema.json';
import testSchema from '@lss/schemas/test.schema.json';

/** PLT-9: same files as packages/schemas — never a local copy of C1–C6. */
export type ContractName =
  | 'target-environment'
  | 'health-snapshot'
  | 'dependency-edge'
  | 'usage-report'
  | 'diagnostic-error'
  | 'test';

const schemas: Record<ContractName, object> = {
  'target-environment': targetEnvironmentSchema,
  'health-snapshot': healthSnapshotSchema,
  'dependency-edge': dependencyEdgeSchema,
  'usage-report': usageReportSchema,
  'diagnostic-error': diagnosticErrorSchema,
  test: testSchema,
};

const ajv = addFormats(new Ajv2020({ allErrors: true, strict: false }));
const validators = {
  'target-environment': ajv.compile(targetEnvironmentSchema),
  'health-snapshot': ajv.compile(healthSnapshotSchema),
  'dependency-edge': ajv.compile(dependencyEdgeSchema),
  'usage-report': ajv.compile(usageReportSchema),
  'diagnostic-error': ajv.compile(diagnosticErrorSchema),
  test: ajv.compile(testSchema),
} as const;

export class ContractError extends Error {
  constructor(
    public readonly contract: ContractName,
    public readonly issues: ErrorObject[] | null | undefined,
  ) {
    const detail = (issues ?? [])
      .map((e) => `${e.instancePath || '/'} ${e.message ?? 'invalid'}`)
      .join('; ');
    super(`Contract ${contract} payload failed schema validation${detail ? `: ${detail}` : ''}`);
    this.name = 'ContractError';
  }
}

export function isValidContract(contract: ContractName, document: unknown): boolean {
  return validators[contract](document) === true;
}

export function assertContract(contract: ContractName, document: unknown): void {
  if (!isValidContract(contract, document)) {
    throw new ContractError(contract, validators[contract].errors);
  }
}

export function schemaFor(contract: ContractName): object {
  return schemas[contract];
}
