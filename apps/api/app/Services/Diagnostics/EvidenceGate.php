<?php

namespace App\Services\Diagnostics;

use InvalidArgumentException;

/**
 * DX-15/DX-22: reject any finding that lacks analyser source, ruleId, file,
 * and range. DX-22 additionally rejects findings whose source is not
 * registered in the AnalyzerRegistry (when one is provided).
 *
 * Nothing without reproducible evidence may enter the errors table.
 */
final class EvidenceGate
{
    public function __construct(
        private readonly ?AnalyzerRegistry $registry = null,
    ) {}

    /**
     * @param  array<string, mixed>  $finding
     * @return array{
     *   source: string,
     *   ruleId: string,
     *   kind: string,
     *   severity: string,
     *   file: string,
     *   range: array{startLine: int, startCol: int, endLine: int, endCol: int},
     *   message: string,
     *   explanation: string|null,
     *   upstream: list<string>,
     *   downstream: list<string>
     * }
     */
    public function accept(array $finding): array
    {
        $source = $finding['source'] ?? null;
        $ruleId = $finding['ruleId'] ?? null;
        $file = $finding['file'] ?? null;
        $range = $finding['range'] ?? null;
        $message = $finding['message'] ?? null;

        if (! is_string($source) || $source === '') {
            throw new InvalidArgumentException('Finding rejected: missing source analyser.');
        }

        // DX-22: when a registry is provided, source must match a registered adapter.
        if ($this->registry !== null && ! $this->registry->isRegistered($source)) {
            $known = implode(', ', $this->registry->registeredIds()) ?: '(none)';
            throw new InvalidArgumentException(
                "Finding rejected: source '{$source}' is not a registered adapter. Known: {$known}.",
            );
        }

        if (! is_string($ruleId) || $ruleId === '') {
            throw new InvalidArgumentException('Finding rejected: missing ruleId.');
        }
        if (! is_string($file) || $file === '') {
            throw new InvalidArgumentException('Finding rejected: missing file.');
        }
        if (! is_array($range)
            || ! isset($range['startLine'], $range['startCol'], $range['endLine'], $range['endCol'])
            || (int) $range['startLine'] < 1) {
            throw new InvalidArgumentException('Finding rejected: missing or invalid range.');
        }
        if (! is_string($message)) {
            throw new InvalidArgumentException('Finding rejected: missing message.');
        }

        $kind = is_string($finding['kind'] ?? null) ? $finding['kind'] : 'other';
        $severity = is_string($finding['severity'] ?? null) ? $finding['severity'] : 'error';
        if (! in_array($severity, ['error', 'warning', 'info'], true)) {
            $severity = 'error';
        }

        return [
            'source' => $source,
            'ruleId' => $ruleId,
            'kind' => $kind,
            'severity' => $severity,
            'file' => $file,
            'range' => [
                'startLine' => (int) $range['startLine'],
                'startCol' => (int) $range['startCol'],
                'endLine' => (int) $range['endLine'],
                'endCol' => (int) $range['endCol'],
            ],
            'message' => $message,
            'explanation' => isset($finding['explanation']) && is_string($finding['explanation'])
                ? $finding['explanation']
                : null,
            'upstream' => array_values(array_filter(
                is_array($finding['upstream'] ?? null) ? $finding['upstream'] : [],
                'is_string',
            )),
            'downstream' => array_values(array_filter(
                is_array($finding['downstream'] ?? null) ? $finding['downstream'] : [],
                'is_string',
            )),
        ];
    }
}
