<?php

namespace App\Services\Diagnostics;

use Illuminate\Support\Facades\Process;
use RuntimeException;

/**
 * DX-2 / DX-16: run PHPStan analysis-only against a sandbox.
 * For CodeIgniter 3 (no composer), writes a temporary neon config with
 * scanDirectories for application/ + system/ and a low analysis level.
 *
 * When PHPStan binary is unavailable, returns an empty list (never fabricates).
 * Tests inject findings via {@see PhpStanAdapter::withJsonRunner()}.
 */
final class PhpStanAdapter implements Analyzer
{
    /**
     * Real legacy codebases (thousands of untyped files) exceed PHP's default
     * 128M inside PHPStan's own analysis workers well before level-0 analysis
     * completes — see vault "10 Iteration 1" pilot notes for the measured case.
     */
    private const MEMORY_LIMIT = '2G';

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
        return 'phpstan';
    }

    /** True when the Maintain API has a PHPStan binary (or a test json runner). */
    public function binaryAvailable(): bool
    {
        if ($this->jsonRunner !== null) {
            return true;
        }

        return $this->resolveBinary() !== null;
    }

    /**
     * Status for the last {@see run()} call: missing_binary | clean | ok.
     */
    public function lastRunStatus(): ?string
    {
        return $this->lastRunStatus;
    }

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

        $configPath = $this->ensureConfig($sandboxPath);
        $result = Process::path($sandboxPath)
            ->timeout(600)
            ->run([
                $binary,
                'analyse',
                '--error-format=json',
                '--no-progress',
                // Real codebases (thousands of legacy files) exceed PHP's
                // default 128M under PHPStan's own analysis workers; without
                // this, a crash silently normalizes to "0 findings" — a false
                // "all clear" that violates the evidence-only accuracy policy
                // (vault note 10). 2G is generous for a single-project scan.
                '--memory-limit='.self::MEMORY_LIMIT,
                '-c',
                $configPath,
            ]);

        $json = $result->output();

        if ($json === '' && $result->errorOutput() !== '') {
            // PHPStan wrote nothing to stdout but produced stderr — this means
            // the process failed to start or crashed before producing JSON output.
            // Surface as a hard error rather than a misleading "clean" result.
            throw new RuntimeException('PHPStan produced no output: '.trim($result->errorOutput()));
        }

        $findings = $this->normalize($json, $sandboxPath);
        $this->lastRunStatus = $findings === [] ? 'clean' : 'ok';

        return $findings;
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

        // PHPStan's own JSON envelope reports worker crashes (e.g. memory
        // exhaustion) in general_errors even when it still exits with some
        // stdout. Surface these as a real failure instead of returning an
        // empty (and therefore misleadingly "clean") finding list.
        if (($decoded['general_errors'] ?? []) !== []) {
            $reasons = implode('; ', array_map(
                static fn (mixed $e): string => strtok((string) $e, "\n") ?: (string) $e,
                array_slice($decoded['general_errors'], 0, 3),
            ));

            throw new RuntimeException("PHPStan analysis did not complete: {$reasons}");
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
                $ruleId = (string) ($msg['identifier'] ?? $msg['tip'] ?? 'phpstan.unknown');
                if ($ruleId === '') {
                    $ruleId = 'phpstan.unknown';
                }
                $message = (string) ($msg['message'] ?? '');
                if ($message === '') {
                    continue;
                }
                $classified = $this->taxonomy->classify('phpstan', $ruleId, $message);
                $findings[] = [
                    'source' => 'phpstan',
                    'ruleId' => $ruleId,
                    'kind' => $classified['kind'],
                    'severity' => (($msg['ignorable'] ?? false) === true) ? 'warning' : 'error',
                    'file' => $relative,
                    'range' => [
                        'startLine' => $line,
                        'startCol' => 0,
                        'endLine' => $line,
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
        // Explicit override (including tests forcing a missing path) skips vendor discovery.
        if ($this->binary !== null) {
            return is_file($this->binary) ? $this->binary : null;
        }

        $candidates = [
            base_path('vendor/bin/phpstan'),
            base_path('vendor/bin/phpstan.bat'),
        ];
        foreach ($candidates as $candidate) {
            if (is_file($candidate)) {
                return $candidate;
            }
        }

        return null;
    }

    /**
     * DX-16: write a CI3-friendly config when no composer.json / phpstan.neon exists.
     */
    public function ensureConfig(string $sandboxPath): string
    {
        foreach (['phpstan.neon', 'phpstan.neon.dist'] as $name) {
            $existing = $sandboxPath.DIRECTORY_SEPARATOR.$name;
            if (is_file($existing)) {
                return $existing;
            }
        }

        $isCi3 = is_dir($sandboxPath.DIRECTORY_SEPARATOR.'application')
            && is_dir($sandboxPath.DIRECTORY_SEPARATOR.'system')
            && ! is_file($sandboxPath.DIRECTORY_SEPARATOR.'composer.json');

        $configPath = $sandboxPath.DIRECTORY_SEPARATOR.'.lss-phpstan.neon';
        if ($isCi3) {
            $neon = <<<'NEON'
includes: []
parameters:
    level: 0
    paths:
        - application
    excludePaths:
        - application/cache/*
        - application/logs/*
    scanDirectories:
        - system
    reportUnmatchedIgnoredErrors: false
NEON;
        } else {
            $paths = [];
            foreach (['app', 'src', 'application'] as $dir) {
                if (is_dir($sandboxPath.DIRECTORY_SEPARATOR.$dir)) {
                    $paths[] = $dir;
                }
            }
            if ($paths === []) {
                $paths[] = '.';
            }
            $pathLines = implode("\n", array_map(fn (string $p): string => "        - {$p}", $paths));
            $neon = <<<NEON
parameters:
    level: 1
    paths:
{$pathLines}
    reportUnmatchedIgnoredErrors: false
NEON;
        }

        if (file_put_contents($configPath, $neon) === false) {
            throw new RuntimeException('Unable to write PHPStan config.');
        }

        return $configPath;
    }
}
