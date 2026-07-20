<?php

namespace App\Services\Diagnostics;

/**
 * DX-1: analyser adapter contract. Implementations must return evidence-complete
 * C5 findings (minus optional chain fields) — never invent errors.
 *
 * @phpstan-type Finding array{
 *   source: string,
 *   ruleId: string,
 *   kind: string,
 *   severity: string,
 *   file: string,
 *   range: array{startLine: int, startCol: int, endLine: int, endCol: int},
 *   message: string,
 *   explanation?: string|null,
 *   upstream?: list<string>,
 *   downstream?: list<string>
 * }
 */
interface Analyzer
{
    /** Analyser id used in C5 `source` (phpstan, eslint, tsc, …). */
    public function source(): string;

    /**
     * @return list<Finding>
     */
    public function run(string $sandboxPath): array;
}
