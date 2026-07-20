<?php

namespace App\Services\Diagnostics;

/**
 * Minimal DX-5 taxonomy: map analyser ruleId → kind + explanation template.
 * Unmapped rules fall back to `other` with the raw message — never dropped.
 */
final class Taxonomy
{
    /** @var array<string, array{kind: string, explanation: string}> */
    private array $map;

    public function __construct(?string $jsonPath = null)
    {
        $candidates = array_filter([
            $jsonPath,
            dirname(base_path(), 2).DIRECTORY_SEPARATOR.'packages'.DIRECTORY_SEPARATOR.'schemas'.DIRECTORY_SEPARATOR.'taxonomy.json',
            storage_path('taxonomy.json'),
        ]);
        $this->map = [];
        foreach ($candidates as $candidate) {
            if (is_string($candidate) && is_file($candidate)) {
                $decoded = json_decode((string) file_get_contents($candidate), true);
                if (is_array($decoded)) {
                    /** @var array<string, array{kind: string, explanation: string}> $decoded */
                    $this->map = $decoded;

                    return;
                }
            }
        }

        $this->map = $this->defaults();
    }

    /**
     * @return array{kind: string, explanation: string}
     */
    public function classify(string $source, string $ruleId, string $message): array
    {
        $key = $source.':'.$ruleId;
        if (isset($this->map[$key])) {
            return $this->map[$key];
        }
        if (isset($this->map[$ruleId])) {
            return $this->map[$ruleId];
        }

        return [
            'kind' => 'other',
            'explanation' => $message,
        ];
    }

    /**
     * @return array<string, array{kind: string, explanation: string}>
     */
    private function defaults(): array
    {
        return [
            'phpstan:nullCoalesce.variable' => [
                'kind' => 'null-risk',
                'explanation' => 'A value may be null here; callers can hit a runtime TypeError or silent skip.',
            ],
            'phpstan:property.nonObject' => [
                'kind' => 'null-risk',
                'explanation' => 'Property access on a possibly-null object fails at runtime.',
            ],
            'phpstan:argument.type' => [
                'kind' => 'type-error',
                'explanation' => 'Argument type does not match the declared parameter; expect TypeError or wrong behaviour.',
            ],
            'phpstan:return.type' => [
                'kind' => 'type-error',
                'explanation' => 'Returned value does not match the declared return type.',
            ],
            'phpstan:class.notFound' => [
                'kind' => 'missing-dep',
                'explanation' => 'Referenced class cannot be resolved — missing autoload or undeclared dependency.',
            ],
            'phpstan:function.notFound' => [
                'kind' => 'missing-dep',
                'explanation' => 'Referenced function cannot be resolved.',
            ],
        ];
    }
}
