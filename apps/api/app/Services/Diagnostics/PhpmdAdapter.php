<?php

namespace App\Services\Diagnostics;

use Illuminate\Support\Facades\Process;

/**
 * DX-30: run API-owned PHPMD against a sandbox (analysis-only).
 *
 * Invokes Maintain's vendor binary with a JSON report — never executes imported
 * project PHP as trusted code.
 */
final class PhpmdAdapter implements Analyzer
{
    private const RULESETS = 'cleancode,codesize,design,naming,unusedcode';

    /** @var callable(string): string|null */
    private $jsonRunner;

    private ?string $lastRunStatus = null;

    public function __construct(
        private readonly Taxonomy $taxonomy = new Taxonomy,
        private readonly ?string $binary = null,
        ?callable $jsonRunner = null,
    ) {
        $this->jsonRunner = $jsonRunner;
    }

    public static function withJsonRunner(callable $jsonRunner, ?Taxonomy $taxonomy = null): self
    {
        return new self($taxonomy ?? new Taxonomy, null, $jsonRunner);
    }

    public function source(): string
    {
        return 'phpmd';
    }

    public function runStatus(): ?string
    {
        return $this->lastRunStatus;
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function run(string $sandboxPath): array
    {
        if ($this->jsonRunner !== null) {
            $json = ($this->jsonRunner)($sandboxPath);
            $findings = $this->normalize($json, $sandboxPath);
            $this->lastRunStatus = $findings === [] ? 'clean' : 'ok';

            return $findings;
        }

        $binary = $this->resolveBinary();
        if ($binary === null) {
            $this->lastRunStatus = 'missing_binary';

            return [];
        }

        $targets = $this->scanTargets($sandboxPath);
        if ($targets === []) {
            $this->lastRunStatus = 'clean';

            return [];
        }

        $cmd = [
            PHP_BINARY,
            $binary,
            'analyze',
            ...$targets,
            '--format=json',
            '--no-progress',
            '--ignore-violations-on-exit',
            '--ruleset='.self::RULESETS,
            '--exclude=vendor',
            '--exclude=node_modules',
            '--exclude=storage',
            '--exclude=cache',
            '--exclude=logs',
        ];

        $result = Process::path($sandboxPath)
            ->timeout(300)
            ->run($cmd);

        $json = $result->output();
        if ($json === '' && trim($result->errorOutput()) !== '') {
            $this->lastRunStatus = 'clean';

            return [];
        }

        $findings = $this->normalize($json, $sandboxPath);
        $this->lastRunStatus = $findings === [] ? 'clean' : 'ok';

        return $findings;
    }

    /**
     * @return list<string>
     */
    private function scanTargets(string $sandboxPath): array
    {
        foreach (['app', 'application', 'src', 'lib'] as $candidate) {
            if (is_dir($sandboxPath.DIRECTORY_SEPARATOR.$candidate)) {
                return [$candidate];
            }
        }

        return ['.'];
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function normalize(string $json, string $sandboxPath): array
    {
        $decoded = json_decode($json, true);
        if (! is_array($decoded)) {
            return [];
        }

        $files = $decoded['files'] ?? [];
        if (! is_array($files)) {
            return [];
        }

        $root = rtrim(str_replace('\\', '/', $sandboxPath), '/').'/';
        $findings = [];

        foreach ($files as $payload) {
            if (! is_array($payload)) {
                continue;
            }

            $filePath = (string) ($payload['file'] ?? $payload['relativePath'] ?? '');
            $relative = str_replace('\\', '/', $filePath);
            if ($relative === '') {
                continue;
            }
            if (str_starts_with($relative, $root)) {
                $relative = substr($relative, strlen($root));
            } elseif (isset($payload['relativePath']) && is_string($payload['relativePath'])) {
                $relative = str_replace('\\', '/', $payload['relativePath']);
            }

            $violations = $payload['violations'] ?? [];
            if (! is_array($violations)) {
                continue;
            }

            foreach ($violations as $violation) {
                if (! is_array($violation)) {
                    continue;
                }
                $line = (int) ($violation['beginLine'] ?? 0);
                if ($line < 1) {
                    continue;
                }
                $rule = (string) ($violation['rule'] ?? 'unknown');
                $ruleSet = (string) ($violation['ruleSet'] ?? '');
                $ruleId = $ruleSet !== '' ? $ruleSet.'.'.$rule : $rule;
                $message = (string) ($violation['description'] ?? '');
                if ($message === '') {
                    continue;
                }
                $priority = (int) ($violation['priority'] ?? 3);
                $severity = $priority <= 2 ? 'error' : 'warning';
                $classified = $this->taxonomy->classify('phpmd', $ruleId, $message);
                $endLine = max($line, (int) ($violation['endLine'] ?? $line));
                $findings[] = [
                    'source' => 'phpmd',
                    'ruleId' => $ruleId,
                    'kind' => $classified['kind'],
                    'severity' => $severity,
                    'file' => $relative,
                    'range' => [
                        'startLine' => $line,
                        'startCol' => 0,
                        'endLine' => $endLine,
                        'endCol' => 0,
                    ],
                    'message' => $message,
                    'explanation' => $classified['explanation'],
                    'upstream' => [],
                    'downstream' => [],
                ];
            }
        }

        return $findings;
    }

    private function resolveBinary(): ?string
    {
        if ($this->binary !== null) {
            return is_file($this->binary) ? $this->binary : null;
        }

        $candidates = [
            base_path('vendor/bin/phpmd'),
            base_path('vendor/phpmd/phpmd/bin/phpmd'),
        ];
        foreach ($candidates as $candidate) {
            if (is_file($candidate)) {
                return $candidate;
            }
        }

        return null;
    }
}
