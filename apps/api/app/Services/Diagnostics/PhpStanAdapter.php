<?php

namespace App\Services\Diagnostics;

use App\Services\Import\StackDetector;
use Illuminate\Support\Facades\Process;
use RuntimeException;

/**
 * DX-2 / DX-16 / DX-20 / DX-21: run PHPStan analysis-only against a sandbox.
 * For CodeIgniter 3 (no composer), writes a temporary neon config with
 * scanDirectories for application/ + system/ and a low analysis level.
 * DX-21: CI3 detection is delegated to StackDetector (single source of truth).
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
        private readonly StackDetector $stackDetector = new StackDetector,
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
     *
     * @deprecated Use runStatus() (Analyzer interface). Kept for backward compat.
     */
    public function lastRunStatus(): ?string
    {
        return $this->lastRunStatus;
    }

    /**
     * DX-20: polymorphic run status — satisfies the Analyzer interface.
     * Delegates to lastRunStatus(); may be null before the first run().
     */
    public function runStatus(): ?string
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
                PHP_BINARY,
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

    /**
     * Return (or create) the PHPStan neon config path for this sandbox.
     *
     * DX-21: CI3 detection uses StackDetector — no duplicate hasComposer /
     * is_dir logic here. For a CI3 project, writes a temporary neon that
     * sets scanDirectories to application/ + system/ at level 0 so PHPStan
     * doesn't choke on legacy globals.
     */
    public function ensureConfig(string $sandboxPath): string
    {
        $sep = DIRECTORY_SEPARATOR;
        $existing = $sandboxPath.$sep.'.lss-phpstan.neon';

        if (is_file($existing)) {
            return $existing;
        }

        // DX-21: single CI3 detection via StackDetector
        $profile = $this->stackDetector->detect($sandboxPath);

        if ($profile->isCi3) {
            // CI3 projects have no autoloader; use scanDirectories instead of
            // paths so PHPStan reads the raw files without requiring autoload.
            $neon = <<<NEON
parameters:
    level: 0
    scanDirectories:
        - application
        - system
    reportUnmatchedIgnoredErrors: false
NEON;
        } else {
            $neon = <<<NEON
parameters:
    level: 1
    paths:
        - .
    reportUnmatchedIgnoredErrors: false
NEON;
        }

        $configPath = $sandboxPath.$sep.'.lss-phpstan.neon';
        file_put_contents($configPath, $neon);

        return $configPath;
    }

    /**
     * Resolve the PHPStan PHP entry-point script (not a .bat shim).
     *
     * Candidate order:
     *   1. vendor/phpstan/phpstan/phpstan — the real Composer package entry-point (a PHP file).
     *   2. vendor/bin/phpstan             — the bash proxy Composer installs in bin/.
     *
     * The .bat shim (vendor/bin/phpstan.bat) is intentionally excluded: it
     * re-invokes plain `php` from PATH, which is not guaranteed to exist in the
     * environment the API / queue worker runs under on Windows (PATH-less service
     * accounts, etc.).  We invoke the resolved script via PHP_BINARY in run(),
     * so any PHP file is sufficient — no shell PATH lookup required.
     */
    private function resolveBinary(): ?string
    {
        // Explicit override (including tests forcing a missing path) skips vendor discovery.
        if ($this->binary !== null) {
            return is_file($this->binary) ? $this->binary : null;
        }

        $candidates = [
            base_path('vendor/phpstan/phpstan/phpstan'),
            base_path('vendor/bin/phpstan'),
        ];
        foreach ($candidates as $candidate) {
            if (is_file($candidate)) {
                return $candidate;
            }
        }

        return null;
    }
}
