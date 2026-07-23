<?php

namespace App\Services\Diagnostics;

use App\Services\Import\StackDetector;
use Illuminate\Support\Facades\Process;
use RuntimeException;

/**
 * DX-2 / DX-16 / DX-20 / DX-21: run PHPStan analysis-only against a sandbox.
 *
 * Phase 5: sharded progressive runs, --cache-dir, parallel neon, CI3 app-first
 * (system/ only when PHPSTAN_DEEP=true).
 */
final class PhpStanAdapter implements Analyzer
{
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

    public function usesInjectedRunner(): bool
    {
        return $this->jsonRunner !== null;
    }

    public function binaryAvailable(): bool
    {
        if ($this->jsonRunner !== null) {
            return true;
        }

        return $this->resolveBinary() !== null;
    }

    public function lastRunStatus(): ?string
    {
        return $this->lastRunStatus;
    }

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

        return $this->runShard($sandboxPath, null, 'full');
    }

    /**
     * Plan analysis shards (top-level dirs under application/src/app, or explicit paths).
     *
     * @param  list<string>|null  $onlyPaths
     * @return list<array{label: string, paths: list<string>|null}>
     */
    public function planShards(string $sandboxPath, ?array $onlyPaths = null): array
    {
        if ($onlyPaths !== null) {
            if ($onlyPaths === []) {
                return [];
            }
            $chunks = array_chunk(array_values($onlyPaths), 40);

            return array_map(
                fn (array $chunk, int $i): array => [
                    'label' => 'changed:'.($i + 1).'/'.count($chunks),
                    'paths' => $chunk,
                ],
                $chunks,
                array_keys($chunks),
            );
        }

        $profile = $this->stackDetector->detect($sandboxPath);
        $deep = (bool) config('speed.phpstan_deep', false);

        if ($profile->isCi3) {
            $shards = [];
            $appRoot = $sandboxPath.DIRECTORY_SEPARATOR.'application';
            if (is_dir($appRoot)) {
                foreach ($this->childDirs($appRoot) as $dir) {
                    $rel = 'application/'.$dir;
                    $shards[] = ['label' => $rel, 'paths' => [$rel]];
                }
                if ($shards === []) {
                    $shards[] = ['label' => 'application', 'paths' => ['application']];
                }
            }
            if ($deep && is_dir($sandboxPath.DIRECTORY_SEPARATOR.'system')) {
                $shards[] = ['label' => 'system', 'paths' => ['system']];
            }

            return $shards;
        }

        foreach (['src', 'app', 'application'] as $candidate) {
            $abs = $sandboxPath.DIRECTORY_SEPARATOR.$candidate;
            if (! is_dir($abs)) {
                continue;
            }
            $shards = [];
            foreach ($this->childDirs($abs) as $dir) {
                $rel = $candidate.'/'.$dir;
                $shards[] = ['label' => $rel, 'paths' => [$rel]];
            }
            if ($shards !== []) {
                return $shards;
            }

            return [['label' => $candidate, 'paths' => [$candidate]]];
        }

        return [['label' => 'full', 'paths' => null]];
    }

    /**
     * @param  list<string>|null  $paths  Relative paths/dirs; null = neon defaults
     * @return list<array<string, mixed>>
     */
    public function runShard(string $sandboxPath, ?array $paths, string $label = 'shard'): array
    {
        if ($this->jsonRunner !== null) {
            return $this->run($sandboxPath);
        }

        $binary = $this->resolveBinary();
        if ($binary === null) {
            $this->lastRunStatus = 'missing_binary';

            return [];
        }

        $configPath = $this->ensureConfig($sandboxPath);
        $tmpDir = $this->writableTmpDir();
        $cacheDir = $this->projectCacheDir($sandboxPath);

        $cmd = [
            PHP_BINARY,
            $binary,
            'analyse',
            '--error-format=json',
            '--no-progress',
            '--memory-limit='.self::MEMORY_LIMIT,
            '-c',
            $configPath,
        ];

        if (config('speed.phpstan_cache_dir', true)) {
            $cmd[] = '--cache-dir='.$cacheDir;
        }

        if ($paths !== null) {
            foreach ($paths as $path) {
                $cmd[] = $path;
            }
        }

        $result = Process::path($sandboxPath)
            ->timeout(600)
            ->env($this->processEnvWithTmp($tmpDir))
            ->run($cmd);

        $json = $result->output();
        $stderr = $result->errorOutput();

        if ($json === '' && $stderr !== '') {
            if ($this->isNoFilesToAnalyse($stderr)) {
                $this->lastRunStatus = $this->lastRunStatus ?? 'clean';

                return [];
            }

            throw new RuntimeException('PHPStan produced no output ['.$label.']: '.trim($stderr));
        }

        $findings = $this->normalize($json, $sandboxPath);
        if ($findings !== []) {
            $this->lastRunStatus = 'ok';
        } elseif ($this->lastRunStatus !== 'ok') {
            $this->lastRunStatus = 'clean';
        }

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

    public function ensureConfig(string $sandboxPath): string
    {
        $sep = DIRECTORY_SEPARATOR;
        $deep = (bool) config('speed.phpstan_deep', false);
        $configName = $deep ? '.lss-phpstan-deep.neon' : '.lss-phpstan.neon';
        $configPath = $sandboxPath.$sep.$configName;

        // Always rewrite so parallel / wave flags stay current.
        $profile = $this->stackDetector->detect($sandboxPath);
        $parallel = (int) config('speed.phpstan_parallel', 0);
        if ($parallel <= 0) {
            $cpus = (int) (function_exists('swoole_cpu_num') ? swoole_cpu_num() : (getenv('NUMBER_OF_PROCESSORS') ?: 4));
            $parallel = max(2, $cpus - 1);
        }

        $exclude = <<<'NEON'
    excludePaths:
        - vendor
        - node_modules
        - cache
        - logs
        - storage
NEON;

        $parallelBlock = <<<NEON
    parallel:
        maximumNumberOfProcesses: {$parallel}
NEON;

        if ($profile->isCi3) {
            $scanDirs = $deep
                ? "        - application\n        - system"
                : '        - application';
            $neon = <<<NEON
parameters:
    level: 0
    scanDirectories:
{$scanDirs}
{$exclude}
{$parallelBlock}
    reportUnmatchedIgnoredErrors: false
NEON;
        } else {
            $neon = <<<NEON
parameters:
    level: 1
    paths:
        - .
{$exclude}
{$parallelBlock}
    reportUnmatchedIgnoredErrors: false
NEON;
        }

        file_put_contents($configPath, $neon);

        // Keep legacy filename for older tests that look for .lss-phpstan.neon
        if (! $deep) {
            @copy($configPath, $sandboxPath.$sep.'.lss-phpstan.neon');
        }

        return $configPath;
    }

    private function isNoFilesToAnalyse(string $stderr): bool
    {
        return stripos($stderr, 'No files found to analyse') !== false;
    }

    private function writableTmpDir(): string
    {
        $dir = storage_path('framework'.DIRECTORY_SEPARATOR.'phpstan');
        if (! is_dir($dir)) {
            mkdir($dir, 0755, true);
        }

        return $dir;
    }

    private function projectCacheDir(string $sandboxPath): string
    {
        $key = substr(hash('sha256', $sandboxPath), 0, 16);
        $dir = storage_path('framework'.DIRECTORY_SEPARATOR.'phpstan'.DIRECTORY_SEPARATOR.$key);
        if (! is_dir($dir)) {
            mkdir($dir, 0755, true);
        }

        return $dir;
    }

    /**
     * @return list<string>
     */
    private function childDirs(string $abs): array
    {
        $out = [];
        foreach (scandir($abs) ?: [] as $entry) {
            if ($entry === '.' || $entry === '..') {
                continue;
            }
            if (is_dir($abs.DIRECTORY_SEPARATOR.$entry)) {
                $out[] = $entry;
            }
        }
        sort($out);

        return $out;
    }

    /**
     * @return array<string, string>
     */
    private function processEnvWithTmp(string $tmpDir): array
    {
        $env = [];
        foreach (array_merge($_SERVER, $_ENV) as $key => $value) {
            if (is_string($key) && is_string($value) && preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/', $key) === 1) {
                $env[$key] = $value;
            }
        }
        $env['TMP'] = $tmpDir;
        $env['TEMP'] = $tmpDir;
        $env['TMPDIR'] = $tmpDir;

        return $env;
    }

    private function resolveBinary(): ?string
    {
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
