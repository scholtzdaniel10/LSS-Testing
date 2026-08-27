<?php

namespace App\Support\Contracts;

/**
 * PLT-9: shape persisted/API documents so they match C1/C3/C5 schemas.
 * Optional fields are omitted when unknown — additionalProperties is false and
 * typed fields (string/integer) do not accept JSON null.
 */
final class ContractDocuments
{
    /**
     * @param  array<string, mixed>  $env
     * @return array<string, mixed>
     */
    public static function targetEnvironment(array $env): array
    {
        $out = [
            'id' => (string) ($env['id'] ?? ''),
            'projectId' => (string) ($env['projectId'] ?? ''),
            'name' => (string) ($env['name'] ?? ''),
            'baseUrl' => (string) ($env['baseUrl'] ?? ''),
        ];
        if (isset($env['notes']) && is_string($env['notes'])) {
            $out['notes'] = $env['notes'];
        }

        ContractSchema::validate(ContractSchema::C1, $out);

        return $out;
    }

    /**
     * @param  array<string, mixed>  $edge
     * @return array<string, mixed>
     */
    public static function edge(array $edge): array
    {
        $out = [
            'from' => (string) ($edge['from'] ?? ''),
            'to' => (string) ($edge['to'] ?? ''),
            'kind' => (string) ($edge['kind'] ?? ''),
        ];
        if (isset($edge['symbol']) && is_string($edge['symbol']) && $edge['symbol'] !== '') {
            $out['symbol'] = $edge['symbol'];
        }
        $line = $edge['line'] ?? null;
        if (is_numeric($line) && (int) $line >= 1) {
            $out['line'] = (int) $line;
        }

        return $out;
    }

    /**
     * @param  list<array<string, mixed>>  $edges
     * @return list<array<string, mixed>>
     */
    public static function edges(array $edges): array
    {
        $out = [];
        foreach ($edges as $edge) {
            if (! is_array($edge)) {
                continue;
            }
            $normalized = self::edge($edge);
            ContractSchema::validate(ContractSchema::C3, $normalized);
            $out[] = $normalized;
        }

        return $out;
    }

    /**
     * @param  array<string, mixed>  $finding
     * @return array<string, mixed>
     */
    public static function finding(array $finding): array
    {
        $range = is_array($finding['range'] ?? null) ? $finding['range'] : [];
        $out = [
            'id' => (string) ($finding['id'] ?? ''),
            'source' => (string) ($finding['source'] ?? ''),
            'ruleId' => (string) ($finding['ruleId'] ?? ''),
            'kind' => (string) ($finding['kind'] ?? 'other'),
            'severity' => (string) ($finding['severity'] ?? 'error'),
            'file' => (string) ($finding['file'] ?? ''),
            'range' => [
                'startLine' => (int) ($range['startLine'] ?? 1),
                'startCol' => (int) ($range['startCol'] ?? 0),
                'endLine' => (int) ($range['endLine'] ?? 1),
                'endCol' => (int) ($range['endCol'] ?? 0),
            ],
            'message' => (string) ($finding['message'] ?? ''),
        ];
        if (isset($finding['explanation']) && is_string($finding['explanation'])) {
            $out['explanation'] = $finding['explanation'];
        }
        if (isset($finding['upstream']) && is_array($finding['upstream'])) {
            $out['upstream'] = array_values(array_filter($finding['upstream'], 'is_string'));
        }
        if (isset($finding['downstream']) && is_array($finding['downstream'])) {
            $out['downstream'] = array_values(array_filter($finding['downstream'], 'is_string'));
        }

        ContractSchema::validate(ContractSchema::C5, $out);

        return $out;
    }
}
