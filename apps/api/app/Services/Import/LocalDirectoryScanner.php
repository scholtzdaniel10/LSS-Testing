<?php

namespace App\Services\Import;

use App\Support\Sandbox\IgnoreRules;
use FilesystemIterator;
use RecursiveDirectoryIterator;
use RecursiveIteratorIterator;
use RuntimeException;

/**
 * IG-19 local variant: walk a registered on-disk folder with ignore rules.
 *
 * @return array{files: list<array{path: string, size: int, lang: string|null}>, skipped: int}
 */
final class LocalDirectoryScanner
{
    private const MAX_FILES = 25_000;

    public function __construct(
        private readonly IgnoreRules $ignore,
    ) {}

    /**
     * @return array{files: list<array{path: string, size: int, lang: string|null}>, skipped: int}
     */
    public function scan(string $rootPath): array
    {
        @set_time_limit(600);

        $root = realpath($rootPath);
        if ($root === false || ! is_dir($root)) {
            throw new RuntimeException('Local root is not a directory.');
        }

        $files = [];
        $skipped = 0;
        $rootPrefix = rtrim(str_replace('\\', '/', $root), '/').'/';

        $iterator = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS),
        );

        foreach ($iterator as $item) {
            if (! $item->isFile()) {
                continue;
            }

            $absolute = $item->getPathname();
            $relative = ltrim(str_replace('\\', '/', substr($absolute, strlen($rootPrefix))), '/');
            if ($relative === '' || str_contains($relative, "\0")) {
                $skipped++;

                continue;
            }

            if ($this->ignore->shouldSkip($relative)) {
                $skipped++;

                continue;
            }

            $files[] = [
                'path' => $relative,
                'size' => $item->getSize(),
                'lang' => $this->langFor($relative),
            ];

            if (count($files) >= self::MAX_FILES) {
                break;
            }
        }

        usort($files, fn (array $a, array $b): int => strcmp($a['path'], $b['path']));

        return ['files' => $files, 'skipped' => $skipped];
    }

    private function langFor(string $path): ?string
    {
        $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));

        return match ($ext) {
            'php' => 'php',
            'js', 'mjs', 'cjs' => 'javascript',
            'ts', 'tsx' => 'typescript',
            'jsx' => 'javascript',
            'vue' => 'vue',
            'json' => 'json',
            'css', 'scss' => 'css',
            'html', 'htm' => 'html',
            'md' => 'markdown',
            'env' => 'env',
            default => $ext !== '' ? $ext : null,
        };
    }
}
