<?php

namespace App\Support\Sandbox;

use InvalidArgumentException;
use RuntimeException;

/**
 * PLT-8: resolve paths only under the configured sandbox root.
 * Rejects traversal (`..`), absolute escapes, and null bytes.
 */
final class PathJail
{
    public function __construct(
        private readonly string $root,
    ) {}

    public static function fromConfig(): self
    {
        $root = (string) config('sandbox.root');

        return new self($root);
    }

    public function root(): string
    {
        return $this->ensureRoot();
    }

    public function projectRoot(string $projectId): string
    {
        if (! preg_match('/^[0-9a-fA-F-]{36}$/', $projectId)) {
            throw new InvalidArgumentException('Invalid project id for sandbox path.');
        }

        return $this->join($this->ensureRoot(), $projectId);
    }

    /**
     * Resolve a relative path inside a project jail. Throws on escape attempts.
     */
    public function resolve(string $projectId, string $relativePath): string
    {
        return $this->resolveUnder($this->projectRoot($projectId), $relativePath);
    }

    /**
     * Resolve a relative path under an explicit root (local-linked projects).
     */
    public function resolveUnder(string $baseRoot, string $relativePath): string
    {
        $relativePath = str_replace('\\', '/', $relativePath);
        if (str_contains($relativePath, "\0")) {
            throw new InvalidArgumentException('Null byte in path.');
        }
        if (str_starts_with($relativePath, '/') || preg_match('#^[A-Za-z]:/#', $relativePath) === 1) {
            throw new InvalidArgumentException('Absolute paths are not allowed.');
        }

        $base = $this->real($baseRoot);
        $candidate = $this->join($base, $relativePath);
        $real = $this->real($candidate, mustExist: false);

        if ($real !== $base && ! str_starts_with($real, $base.DIRECTORY_SEPARATOR) && ! str_starts_with($real, $base.'/')) {
            throw new InvalidArgumentException('Path escapes the project sandbox.');
        }

        return $real;
    }

    public function assertInsideProject(string $projectId, string $absolutePath): string
    {
        $base = $this->real($this->projectRoot($projectId));
        $real = $this->real($absolutePath);

        if ($real !== $base && ! str_starts_with($real, $base.DIRECTORY_SEPARATOR) && ! str_starts_with($real, $base.'/')) {
            throw new InvalidArgumentException('Path escapes the project sandbox.');
        }

        return $real;
    }

    private function ensureRoot(): string
    {
        $this->ensureDirectory($this->root);

        return $this->real($this->root);
    }

    /** Windows emits E_WARNING when mkdir hits an existing directory — treat as success. */
    private function ensureDirectory(string $path): void
    {
        if (is_dir($path)) {
            return;
        }
        if (is_file($path)) {
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

    private function join(string $base, string $relative): string
    {
        $relative = ltrim(str_replace('\\', '/', $relative), '/');
        $parts = array_values(array_filter(explode('/', $relative), fn (string $p): bool => $p !== '' && $p !== '.'));
        foreach ($parts as $part) {
            if ($part === '..') {
                throw new InvalidArgumentException('Path traversal rejected.');
            }
        }

        return $base.DIRECTORY_SEPARATOR.implode(DIRECTORY_SEPARATOR, $parts);
    }

    private function real(string $path, bool $mustExist = true): string
    {
        if ($mustExist) {
            $real = realpath($path);
            if ($real === false) {
                throw new RuntimeException("Path does not exist: {$path}");
            }

            return $real;
        }

        $parent = dirname($path);
        $this->ensureDirectory($parent);
        $realParent = realpath($parent);
        if ($realParent === false) {
            throw new RuntimeException("Unable to resolve parent: {$parent}");
        }

        return $realParent.DIRECTORY_SEPARATOR.basename($path);
    }
}
