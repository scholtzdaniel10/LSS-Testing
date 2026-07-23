<?php

namespace App\Services\Diagnostics;

use Illuminate\Support\Facades\Process;

/**
 * DX-27: run API-owned PHP_CodeSniffer against a sandbox (analysis-only).
 *
 * Invokes Maintain's vendor binary with a JSON report — never executes imported
 * project PHP as trusted code.
 */
final class PhpcsAdapter implements Analyzer
{
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
        return 'phpcs';
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
            '--report=json',
            '--standard=PSR12',
            '-q',
            '--ignore=vendor/*,node_modules/*,storage/*,cache/*,logs/*',
            ...$targets,
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

        foreach ($files as $filePath => $payload) {
            if (! is_array($payload)) {
                continue;
            }
            $messages = $payload['messages'] ?? [];
            if (! is_array($messages)) {
                continue;
            }

            $relative = str_replace('\\', '/', (string) $filePath);
            if (str_starts_with($relative, $root)) {
                $relative = substr($relative, strlen($root));
            }

            foreach ($messages as $msg) {
                if (! is_array($msg)) {
                    continue;
                }
                $line = (int) ($msg['line'] ?? 0);
                if ($line < 1) {
                    continue;
                }
                $sniff = (string) ($msg['source'] ?? 'phpcs.unknown');
                if ($sniff === '') {
                    $sniff = 'phpcs.unknown';
                }
                $message = (string) ($msg['message'] ?? '');
                if ($message === '') {
                    continue;
                }
                $type = strtoupper((string) ($msg['type'] ?? 'ERROR'));
                $severity = $type === 'WARNING' ? 'warning' : 'error';
                $classified = $this->taxonomy->classify('phpcs', $sniff, $message);
                $findings[] = [
                    'source' => 'phpcs',
                    'ruleId' => $sniff,
                    'kind' => $classified['kind'],
                    'severity' => $severity,
                    'file' => $relative,
                    'range' => [
                        'startLine' => $line,
                        'startCol' => max(0, (int) ($msg['column'] ?? 1) - 1),
                        'endLine' => $line,
                        'endCol' => max(0, (int) ($msg['column'] ?? 1) - 1),
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
            base_path('vendor/bin/phpcs'),
            base_path('vendor/squizlabs/php_codesniffer/bin/phpcs'),
        ];
        foreach ($candidates as $candidate) {
            if (is_file($candidate)) {
                return $candidate;
            }
        }

        return null;
    }
}
