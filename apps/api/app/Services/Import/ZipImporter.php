<?php

namespace App\Services\Import;

use App\Support\Sandbox\IgnoreRules;
use App\Support\Sandbox\PathJail;
use InvalidArgumentException;
use RuntimeException;
use ZipArchive;

/**
 * IG-1 / IG-19: extract an uploaded zip into a path-jailed sandbox.
 * Never executes imported code; skips ignore-rule directories.
 */
final class ZipImporter
{
    public function __construct(
        private readonly PathJail $jail,
        private readonly IgnoreRules $ignore,
    ) {}

    /**
     * @return array{files: list<array{path: string, size: int, lang: string|null}>, skipped: int}
     */
    public function import(string $projectId, string $zipPath): array
    {
        if (! is_file($zipPath)) {
            throw new InvalidArgumentException('Zip archive not found.');
        }

        $zip = new ZipArchive;
        if ($zip->open($zipPath) !== true) {
            throw new InvalidArgumentException('Unable to open zip archive.');
        }

        $projectRoot = $this->jail->projectRoot($projectId);
        if (is_dir($projectRoot)) {
            $this->wipeDirectory($projectRoot);
        }
        $this->ensureDirectory($projectRoot);

        $files = [];
        $skipped = 0;
        $planned = [];

        try {
            for ($i = 0; $i < $zip->numFiles; $i++) {
                $name = $zip->getNameIndex($i);
                if ($name === false) {
                    continue;
                }

                $relative = $this->normalizeEntry($name);
                if ($relative === null) {
                    $skipped++;

                    continue;
                }

                if ($this->ignore->shouldSkip($relative)) {
                    $skipped++;

                    continue;
                }

                $planned[] = ['zipName' => $name, 'relative' => $relative];
            }

            $planned = $this->stripWrapperFolder($planned);

            foreach ($planned as $item) {
                $name = $item['zipName'];
                $relative = $item['relative'];

                if (str_ends_with($relative, '/')) {
                    $dir = $this->jail->resolve($projectId, rtrim($relative, '/'));
                    $this->ensureDirectory($dir);

                    continue;
                }

                $target = $this->jail->resolve($projectId, $relative);
                $this->ensureDirectory(dirname($target));

                $stream = $zip->getStream($name);
                if ($stream === false) {
                    $skipped++;

                    continue;
                }

                $out = fopen($target, 'wb');
                if ($out === false) {
                    fclose($stream);
                    throw new RuntimeException("Unable to write {$relative}");
                }
                stream_copy_to_stream($stream, $out);
                fclose($out);
                fclose($stream);

                $size = filesize($target) ?: 0;
                $files[] = [
                    'path' => $relative,
                    'size' => $size,
                    'lang' => $this->langFor($relative),
                ];
            }
        } finally {
            $zip->close();
        }

        return ['files' => $files, 'skipped' => $skipped];
    }

    private function normalizeEntry(string $name): ?string
    {
        $name = str_replace('\\', '/', $name);
        if (str_contains($name, "\0")) {
            return null;
        }
        // Strip a single top-level folder if the zip wraps contents.
        $parts = array_values(array_filter(explode('/', $name), fn (string $p): bool => $p !== ''));
        if ($parts === []) {
            return null;
        }
        foreach ($parts as $part) {
            if ($part === '..' || $part === '.') {
                return null;
            }
        }
        if (isset($parts[0][1]) && $parts[0][1] === ':') {
            return null;
        }

        return implode('/', $parts);
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

    private function ensureDirectory(string $path): void
    {
        if (is_dir($path)) {
            return;
        }
        if (is_file($path)) {
            // Zip tools sometimes emit a 0-byte file where a directory is needed later.
            if (@filesize($path) === 0) {
                @unlink($path);
            } else {
                throw new RuntimeException("Cannot create directory; file exists: {$path}");
            }
        }
        @mkdir($path, 0755, true);
        if (! is_dir($path)) {
            throw new RuntimeException("Unable to create directory: {$path}");
        }
    }

    /**
     * When every entry lives under one top-level folder (common zip layout), flatten it.
     *
     * @param  list<array{zipName: string, relative: string}>  $planned
     * @return list<array{zipName: string, relative: string}>
     */
    private function stripWrapperFolder(array $planned): array
    {
        if ($planned === []) {
            return [];
        }

        $roots = [];
        foreach ($planned as $item) {
            $parts = explode('/', rtrim($item['relative'], '/'));
            if ($parts === [] || $parts[0] === '') {
                return $planned;
            }
            $roots[$parts[0]] = true;
        }
        if (count($roots) !== 1) {
            return $planned;
        }

        $root = array_key_first($roots);
        $out = [];
        foreach ($planned as $item) {
            $relative = $item['relative'];
            if ($relative === $root || $relative === $root.'/') {
                continue;
            }
            if (str_starts_with($relative, $root.'/')) {
                $relative = substr($relative, strlen($root) + 1);
            }
            $out[] = ['zipName' => $item['zipName'], 'relative' => $relative];
        }

        return $out;
    }

    private function wipeDirectory(string $dir): void
    {
        if (! is_dir($dir)) {
            return;
        }
        $iterator = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($dir, \FilesystemIterator::SKIP_DOTS),
            \RecursiveIteratorIterator::CHILD_FIRST,
        );
        foreach ($iterator as $item) {
            $path = $item->getPathname();
            if ($item->isDir()) {
                rmdir($path);
            } else {
                unlink($path);
            }
        }
        rmdir($dir);
    }
}
