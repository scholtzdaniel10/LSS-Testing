<?php

namespace App\Services\Diagnostics;

use App\Services\Import\StackDetector;
use Illuminate\Process\PendingProcess;
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

    /** Priority child-dir names for progressive first-pass (CI3 / Laravel-ish). */
    private const FIRST_PASS_PRIORITY = [
        'controllers', 'models', 'libraries', 'helpers', 'core', 'modules',
        'services', 'http', 'domain', 'actions', 'livewire', 'console',
        'app', 'src',
    ];

    /** @var callable(string): string|null */
    private $jsonRunner;

    private ?string $lastRunStatus = null;

    /** @var list<array{label: string, paths: list<string>|null}> */
    private array $deferredShards = [];

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
     * Shards deferred by progressive first-pass (empty when full plan fits budget).
     *
     * @return list<array{label: string, paths: list<string>|null}>
     */
    public function deferredShards(): array
    {
        return $this->deferredShards;
    }

    /**
     * Plan analysis shards (top-level dirs under application/src/app, or explicit paths).
     *
     * @param  list<string>|null  $onlyPaths
     * @return list<array{label: string, paths: list<string>|null}>
     */
    public function planShards(string $sandboxPath, ?array $onlyPaths = null): array
    {
        $this->deferredShards = [];

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

        if ($profile->isLegacyPhpLayout) {
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

            return $this->applyProgressiveBudget($sandboxPath, $shards);
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
                return $this->applyProgressiveBudget($sandboxPath, $shards);
            }

            return [['label' => $candidate, 'paths' => [$candidate]]];
        }

        return [['label' => 'full', 'paths' => null]];
    }

    /**
     * @param  list<array{label: string, paths: list<string>|null}>  $shards
     * @return list<array{label: string, paths: list<string>|null}>
     */
    private function applyProgressiveBudget(string $sandboxPath, array $shards): array
    {
        if (! config('speed.phpstan_progressive', true) || $shards === []) {
            return $shards;
        }

        $budget = max(50, (int) config('speed.phpstan_first_pass_max_files', 300));
        $ranked = $shards;
        usort($ranked, function (array $a, array $b): int {
            return $this->shardPriority($a) <=> $this->shardPriority($b);
        });

        $selected = [];
        $files = 0;
        foreach ($ranked as $shard) {
            $count = $this->countPhpFiles($sandboxPath, $shard['paths'] ?? null);
            if ($selected !== [] && ($files + $count) > $budget) {
                break;
            }
            // Oversized first shard: take a file slice so first-pass stays inside budget.
            if ($selected === [] && $count > $budget && ($shard['paths'] ?? null) !== null) {
                $listed = $this->listPhpFiles($sandboxPath, $shard['paths']);
                $take = array_slice($listed, 0, $budget);
                $rest = array_slice($listed, $budget);
                // One process (not N× bootstrap) — parallel lives inside PHPStan neon.
                $selected[] = [
                    'label' => $shard['label'].':first',
                    'paths' => $take,
                ];
                if ($rest !== []) {
                    $this->deferredShards[] = [
                        'label' => $shard['label'].':rest',
                        'paths' => $rest,
                    ];
                }
                $chosenLabel = $shard['label'];
                foreach ($ranked as $restShard) {
                    if ($restShard['label'] === $chosenLabel) {
                        continue;
                    }
                    $this->deferredShards[] = $restShard;
                }

                return $selected;
            }
            $selected[] = $shard;
            $files += $count;
            if ($files >= $budget) {
                break;
            }
        }

        if ($selected === []) {
            $selected = [$ranked[0]];
        }

        $chosen = array_fill_keys(array_map(static fn (array $s): string => $s['label'], $selected), true);
        $this->deferredShards = array_values(array_filter(
            $ranked,
            static fn (array $s): bool => ! isset($chosen[$s['label']]),
        ));

        return $selected;
    }

    /**
     * @param  list<string>  $paths
     * @return list<string>
     */
    private function listPhpFiles(string $sandboxPath, array $paths): array
    {
        $out = [];
        foreach ($paths as $rel) {
            $abs = $sandboxPath.DIRECTORY_SEPARATOR.str_replace(['/', '\\'], DIRECTORY_SEPARATOR, $rel);
            if (is_file($abs) && str_ends_with(strtolower($abs), '.php')) {
                $out[] = str_replace('\\', '/', $rel);

                continue;
            }
            if (! is_dir($abs)) {
                continue;
            }
            $it = new \RecursiveIteratorIterator(
                new \RecursiveDirectoryIterator($abs, \FilesystemIterator::SKIP_DOTS),
            );
            $root = rtrim(str_replace('\\', '/', $sandboxPath), '/').'/';
            foreach ($it as $file) {
                if (! $file->isFile() || ! str_ends_with(strtolower($file->getFilename()), '.php')) {
                    continue;
                }
                $full = str_replace('\\', '/', $file->getPathname());
                $out[] = str_starts_with($full, $root) ? substr($full, strlen($root)) : $full;
            }
        }
        sort($out);

        return $out;
    }

    /**
     * @param  array{label: string, paths: list<string>|null}  $shard
     */
    private function shardPriority(array $shard): int
    {
        $label = strtolower($shard['label']);
        $base = basename(str_replace('\\', '/', $label));
        $idx = array_search($base, self::FIRST_PASS_PRIORITY, true);
        if ($idx === false) {
            return 100 + strlen($label);
        }

        return (int) $idx;
    }

    /**
     * @param  list<string>|null  $paths
     */
    private function countPhpFiles(string $sandboxPath, ?array $paths): int
    {
        if ($paths === null) {
            return 10_000;
        }
        $total = 0;
        foreach ($paths as $rel) {
            $abs = $sandboxPath.DIRECTORY_SEPARATOR.str_replace(['/', '\\'], DIRECTORY_SEPARATOR, $rel);
            if (is_file($abs) && str_ends_with(strtolower($abs), '.php')) {
                $total++;

                continue;
            }
            if (! is_dir($abs)) {
                continue;
            }
            $it = new \RecursiveIteratorIterator(
                new \RecursiveDirectoryIterator($abs, \FilesystemIterator::SKIP_DOTS),
            );
            foreach ($it as $file) {
                if ($file->isFile() && str_ends_with(strtolower($file->getFilename()), '.php')) {
                    $total++;
                }
            }
        }

        return $total;
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

        $cacheSuffix = substr(hash('sha256', $label), 0, 8);
        $configPath = $this->ensureConfig($sandboxPath, $cacheSuffix, $paths);
        $tmpDir = $this->writableTmpDir();

        $cmd = $this->analyseCommand($binary, $configPath, $paths);

        $result = Process::path($sandboxPath)
            ->timeout(600)
            ->env($this->processEnvWithTmp($tmpDir))
            ->run($cmd);

        return $this->findingsFromProcess($result->output(), $result->errorOutput(), $sandboxPath, $label);
    }

    /**
     * Build a pending process for concurrent shard execution.
     *
     * @param  list<string>|null  $paths
     */
    public function pendingShard(string $sandboxPath, ?array $paths, string $label): PendingProcess
    {
        $binary = $this->resolveBinary();
        if ($binary === null) {
            throw new RuntimeException('PHPStan binary missing');
        }

        $cacheSuffix = substr(hash('sha256', $label), 0, 8);
        $configPath = $this->ensureConfig($sandboxPath, $cacheSuffix, $paths);
        $tmpDir = $this->writableTmpDir();

        return Process::path($sandboxPath)
            ->timeout(600)
            ->env($this->processEnvWithTmp($tmpDir))
            ->command($this->analyseCommand($binary, $configPath, $paths));
    }

    /**
     * @param  list<string>|null  $paths
     * @return list<string>
     */
    private function analyseCommand(string $binary, string $configPath, ?array $paths): array
    {
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

        if ($paths !== null) {
            foreach ($paths as $path) {
                $cmd[] = $path;
            }
        }

        return $cmd;
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function findingsFromProcess(string $json, string $stderr, string $sandboxPath, string $label): array
    {
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

    /**
     * @param  list<string>|null  $analysePaths  When set, neon uses these paths only (no broad scanDirectories).
     */
    public function ensureConfig(string $sandboxPath, string $cacheSuffix = '', ?array $analysePaths = null): string
    {
        $sep = DIRECTORY_SEPARATOR;
        $deep = (bool) config('speed.phpstan_deep', false);
        $configName = $deep ? '.lss-phpstan-deep.neon' : '.lss-phpstan.neon';
        if ($cacheSuffix !== '') {
            $configName = $deep
                ? ".lss-phpstan-deep-{$cacheSuffix}.neon"
                : ".lss-phpstan-{$cacheSuffix}.neon";
        }
        $configPath = $sandboxPath.$sep.$configName;

        // Always rewrite so parallel / wave flags stay current.
        $profile = $this->stackDetector->detect($sandboxPath);
        $parallel = (int) config('speed.phpstan_parallel', 0);
        $shardConcurrency = max(1, (int) config('speed.phpstan_shard_concurrency', 4));
        if ($parallel <= 0) {
            $cpus = (int) (function_exists('swoole_cpu_num') ? swoole_cpu_num() : (getenv('NUMBER_OF_PROCESSORS') ?: 4));
            // Leave headroom when multiple shards run together.
            $parallel = max(1, intdiv(max(2, $cpus), min($shardConcurrency, 4)));
        }

        // Trailing (?) marks each path optional — PHPStan 2.x hard-fails on
        // excludePaths entries that don't exist in the sandbox otherwise.
        $exclude = <<<'NEON'
    excludePaths:
        - vendor (?)
        - node_modules (?)
        - cache (?)
        - logs (?)
        - storage (?)
NEON;

        $parallelBlock = <<<NEON
    parallel:
        maximumNumberOfProcesses: {$parallel}
NEON;

        // PHPStan has no --cache-dir CLI flag; the result cache lives in the
        // neon `tmpDir` parameter, so the per-project cache is wired up here.
        if (config('speed.phpstan_cache_dir', true)) {
            $cacheDir = $this->projectCacheDir($sandboxPath);
            if ($cacheSuffix !== '') {
                $cacheDir .= $sep.'s-'.$cacheSuffix;
                if (! is_dir($cacheDir)) {
                    mkdir($cacheDir, 0755, true);
                }
            }
            $cacheDirNeon = str_replace('\\', '/', $cacheDir);
            $parallelBlock .= "\n    tmpDir: \"{$cacheDirNeon}\"";
        }

        $level = $profile->isLegacyPhpLayout ? 0 : 1;

        if ($analysePaths !== null && $analysePaths !== []) {
            $pathLines = '';
            foreach ($analysePaths as $p) {
                $p = str_replace('\\', '/', $p);
                $pathLines .= "        - {$p}\n";
            }
            $neon = <<<NEON
parameters:
    level: {$level}
    paths:
{$pathLines}{$exclude}
{$parallelBlock}
    reportUnmatchedIgnoredErrors: false
NEON;
        } elseif ($profile->isLegacyPhpLayout) {
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
        if (! $deep && $cacheSuffix === '' && $analysePaths === null) {
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
