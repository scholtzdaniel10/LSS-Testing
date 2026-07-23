<?php

namespace App\Services\Diagnostics;

use App\Support\Sandbox\IgnoreRules;

/**
 * DX-26: parse-only PHP test-framework awareness.
 *
 * Detects Pest/PHPUnit via project markers and suggests missing test files for
 * concrete classes under common source roots. Uses PHP's tokenizer only —
 * never executes imported code.
 */
final class PhpTestFrameworkAdapter implements Analyzer
{
    /** @var list<string> */
    private const SOURCE_ROOTS = ['app', 'application', 'src', 'lib'];

    /** @var list<string> */
    private const SKIP_SUFFIXES = [
        'Test',
        'Seeder',
        'Factory',
        'Migration',
        'Kernel',
        'Provider',
        'Middleware',
    ];

    private ?string $lastRunStatus = null;

    public function __construct(
        private readonly Taxonomy $taxonomy = new Taxonomy,
        private readonly IgnoreRules $ignoreRules = new IgnoreRules([]),
    ) {}

    public function source(): string
    {
        return 'php-test';
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
        $ignore = $this->ignoreRules->dirs() === []
            ? IgnoreRules::fromConfig()
            : $this->ignoreRules;

        if (! $this->hasPhpSources($sandboxPath, $ignore)) {
            $this->lastRunStatus = 'clean';

            return [];
        }

        $framework = $this->detectFramework($sandboxPath);
        $findings = [];

        if ($framework === 'none') {
            $anchor = $this->projectAnchorFile($sandboxPath);
            if ($anchor !== null) {
                $classified = $this->taxonomy->classify(
                    'php-test',
                    'no-framework',
                    'No PHPUnit or Pest test framework detected.',
                );
                $findings[] = $this->finding(
                    $anchor['file'],
                    $anchor['line'],
                    'no-framework',
                    'No PHPUnit or Pest test framework detected in this project.',
                    $classified,
                    'info',
                );
            }
        }

        if ($framework !== 'none') {
            foreach ($this->collectClasses($sandboxPath, $ignore) as $class) {
                if ($this->hasMatchingTest($sandboxPath, $class['namespace'], $class['name'])) {
                    continue;
                }
                $classified = $this->taxonomy->classify(
                    'php-test',
                    'missing-test',
                    "Class {$class['name']} has no matching test file.",
                );
                $findings[] = $this->finding(
                    $class['file'],
                    $class['line'],
                    'missing-test',
                    "No test file found for class {$class['name']} (expected tests/.../{$class['name']}Test.php).",
                    $classified,
                    'warning',
                );
            }
        }

        $this->lastRunStatus = $findings === [] ? 'clean' : 'ok';

        return $findings;
    }

    /**
     * @return 'pest'|'phpunit'|'both'|'none'
     */
    public function detectFramework(string $sandboxPath): string
    {
        $hasPest = is_file($sandboxPath.'/tests/Pest.php')
            || $this->composerRequires($sandboxPath, 'pestphp/pest');
        $hasPhpunit = is_file($sandboxPath.'/phpunit.xml')
            || is_file($sandboxPath.'/phpunit.xml.dist')
            || $this->composerRequires($sandboxPath, 'phpunit/phpunit');

        if ($hasPest && $hasPhpunit) {
            return 'both';
        }
        if ($hasPest) {
            return 'pest';
        }
        if ($hasPhpunit) {
            return 'phpunit';
        }

        return 'none';
    }

    private function composerRequires(string $sandboxPath, string $package): bool
    {
        $composerPath = $sandboxPath.'/composer.json';
        if (! is_file($composerPath)) {
            return false;
        }
        $decoded = json_decode((string) file_get_contents($composerPath), true);
        if (! is_array($decoded)) {
            return false;
        }
        foreach (['require', 'require-dev'] as $section) {
            $deps = $decoded[$section] ?? [];
            if (is_array($deps) && array_key_exists($package, $deps)) {
                return true;
            }
        }

        return false;
    }

    private function hasPhpSources(string $sandboxPath, IgnoreRules $ignore): bool
    {
        foreach ($this->iterPhpFiles($sandboxPath, $ignore) as $_file) {
            return true;
        }

        return false;
    }

    /**
     * @return list<array{file: string, line: int, name: string, namespace: string}>
     */
    private function collectClasses(string $sandboxPath, IgnoreRules $ignore): array
    {
        $classes = [];
        foreach ($this->iterPhpFiles($sandboxPath, $ignore) as $relative) {
            if (! $this->isUnderSourceRoot($relative) || $this->shouldSkipFile($relative)) {
                continue;
            }
            $abs = $sandboxPath.DIRECTORY_SEPARATOR.str_replace('/', DIRECTORY_SEPARATOR, $relative);
            $source = (string) file_get_contents($abs);
            foreach ($this->parseClasses($source) as $class) {
                $classes[] = [
                    'file' => $relative,
                    'line' => $class['line'],
                    'name' => $class['name'],
                    'namespace' => $class['namespace'],
                ];
            }
        }

        return $classes;
    }

    /**
     * @return list<array{name: string, namespace: string, line: int}>
     */
    private function parseClasses(string $source): array
    {
        $tokens = token_get_all($source);
        $namespace = '';
        $classes = [];
        $count = count($tokens);

        for ($i = 0; $i < $count; $i++) {
            $token = $tokens[$i];
            if (! is_array($token)) {
                continue;
            }

            if ($token[0] === T_NAMESPACE) {
                $namespace = $this->readNamespace($tokens, $i + 1);

                continue;
            }

            if ($token[0] !== T_CLASS) {
                continue;
            }

            $prev = $this->previousMeaningfulToken($tokens, $i - 1);
            if (in_array($prev, [T_INTERFACE, T_TRAIT, T_ENUM, T_ABSTRACT], true)) {
                continue;
            }

            $name = $this->readIdentifier($tokens, $i + 1);
            if ($name === null) {
                continue;
            }

            $classes[] = [
                'name' => $name,
                'namespace' => $namespace,
                'line' => $token[2],
            ];
        }

        return $classes;
    }

    /**
     * @param  list<mixed>  $tokens
     */
    private function readNamespace(array $tokens, int $start): string
    {
        $parts = [];
        for ($i = $start, $count = count($tokens); $i < $count; $i++) {
            $token = $tokens[$i];
            if ($token === ';' || $token === '{') {
                break;
            }
            if (is_array($token) && in_array($token[0], [T_STRING, T_NAME_QUALIFIED, T_NAME_FULLY_QUALIFIED, T_NS_SEPARATOR], true)) {
                $parts[] = $token[1];
            }
        }

        return trim(implode('', $parts), '\\');
    }

    /**
     * @param  list<mixed>  $tokens
     */
    private function readIdentifier(array $tokens, int $start): ?string
    {
        for ($i = $start, $count = count($tokens); $i < $count; $i++) {
            $token = $tokens[$i];
            if (is_array($token) && $token[0] === T_STRING) {
                return $token[1];
            }
            if ($token === '{') {
                return null;
            }
        }

        return null;
    }

    /**
     * @param  list<mixed>  $tokens
     */
    private function previousMeaningfulToken(array $tokens, int $index): ?int
    {
        for ($i = $index; $i >= 0; $i--) {
            $token = $tokens[$i];
            if (! is_array($token)) {
                continue;
            }
            if (in_array($token[0], [T_WHITESPACE, T_COMMENT, T_DOC_COMMENT], true)) {
                continue;
            }

            return $token[0];
        }

        return null;
    }

    private function hasMatchingTest(string $sandboxPath, string $namespace, string $className): bool
    {
        foreach ($this->testPathCandidates($namespace, $className) as $relative) {
            if (is_file($sandboxPath.DIRECTORY_SEPARATOR.str_replace('/', DIRECTORY_SEPARATOR, $relative))) {
                return true;
            }
        }

        return false;
    }

    /**
     * @return list<string>
     */
    private function testPathCandidates(string $namespace, string $className): array
    {
        $testClass = $className.'Test';
        $candidates = [
            "tests/{$testClass}.php",
            "tests/Unit/{$testClass}.php",
            "tests/Feature/{$testClass}.php",
        ];

        if ($namespace !== '') {
            $nsPath = str_replace('\\', '/', $namespace);
            $candidates[] = "tests/Unit/{$nsPath}/{$testClass}.php";
            $candidates[] = "tests/Feature/{$nsPath}/{$testClass}.php";
            $candidates[] = "tests/{$nsPath}/{$testClass}.php";
        }

        return $candidates;
    }

    /**
     * @return \Generator<int, string>
     */
    private function iterPhpFiles(string $sandboxPath, IgnoreRules $ignore): \Generator
    {
        $iterator = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($sandboxPath, \FilesystemIterator::SKIP_DOTS),
        );

        $root = rtrim(str_replace('\\', '/', $sandboxPath), '/').'/';

        foreach ($iterator as $file) {
            if (! $file->isFile() || strtolower($file->getExtension()) !== 'php') {
                continue;
            }
            $absolute = str_replace('\\', '/', $file->getPathname());
            if (! str_starts_with($absolute, $root)) {
                continue;
            }
            $relative = substr($absolute, strlen($root));
            if ($ignore->shouldSkip($relative) || $this->isTestPath($relative)) {
                continue;
            }

            yield $relative;
        }
    }

    private function isUnderSourceRoot(string $relative): bool
    {
        $first = explode('/', str_replace('\\', '/', $relative))[0] ?? '';

        return in_array($first, self::SOURCE_ROOTS, true);
    }

    private function isTestPath(string $relative): bool
    {
        $normalized = str_replace('\\', '/', $relative);
        if (str_starts_with($normalized, 'tests/') || str_contains($normalized, '/tests/')) {
            return true;
        }

        return preg_match('#(^|/)(test|spec)(/|$)#i', $normalized) === 1;
    }

    private function shouldSkipFile(string $relative): bool
    {
        $base = pathinfo($relative, PATHINFO_FILENAME);
        foreach (self::SKIP_SUFFIXES as $suffix) {
            if (str_ends_with($base, $suffix)) {
                return true;
            }
        }

        return false;
    }

    /**
     * @return array{file: string, line: int}|null
     */
    private function projectAnchorFile(string $sandboxPath): ?array
    {
        if (is_file($sandboxPath.'/composer.json')) {
            return ['file' => 'composer.json', 'line' => 1];
        }

        foreach (['index.php', 'public/index.php', 'artisan'] as $candidate) {
            if (is_file($sandboxPath.'/'.$candidate)) {
                return ['file' => $candidate, 'line' => 1];
            }
        }

        foreach (self::SOURCE_ROOTS as $root) {
            $abs = $sandboxPath.DIRECTORY_SEPARATOR.$root;
            if (! is_dir($abs)) {
                continue;
            }
            foreach (scandir($abs) ?: [] as $entry) {
                if (str_ends_with($entry, '.php')) {
                    return ['file' => $root.'/'.$entry, 'line' => 1];
                }
            }
        }

        return null;
    }

    /**
     * @param  array{kind: string, explanation: string}  $classified
     * @return array<string, mixed>
     */
    private function finding(
        string $file,
        int $line,
        string $ruleId,
        string $message,
        array $classified,
        string $severity,
    ): array {
        return [
            'source' => 'php-test',
            'ruleId' => $ruleId,
            'kind' => $classified['kind'],
            'severity' => $severity,
            'file' => $file,
            'range' => [
                'startLine' => max(1, $line),
                'startCol' => 0,
                'endLine' => max(1, $line),
                'endCol' => 0,
            ],
            'message' => $message,
            'explanation' => $classified['explanation'],
            'upstream' => [],
            'downstream' => [],
        ];
    }
}
