<?php

namespace App\Services\Graph;

use App\Support\Sandbox\IgnoreRules;

/**
 * IG-8/9/10 minimal: extract file-level import/require edges from PHP and JS/TS.
 * Emits C3 edges; symbol omitted when unknown (file-level fallback).
 */
final class DependencyGraphBuilder
{
    private const MAX_FILES = 4000;

    /** @var list<string> */
    private const EXTENSIONS = ['php', 'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'html', 'htm'];

    public function __construct(
        private readonly IgnoreRules $ignore,
    ) {}

    /**
     * Walk the sandbox tree (legacy zip imports). Prefer {@see buildIndexed} when file list exists.
     *
     * @return list<array{from: string, to: string, kind: string, line: int|null}>
     */
    public function build(string $sandboxPath): array
    {
        $paths = [];
        $iterator = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($sandboxPath, \FilesystemIterator::SKIP_DOTS),
        );

        foreach ($iterator as $file) {
            if (! $file->isFile()) {
                continue;
            }
            $relative = ltrim(str_replace('\\', '/', substr($file->getPathname(), strlen(rtrim($sandboxPath, '\\/')))), '/');
            if ($this->ignore->shouldSkip($relative)) {
                continue;
            }
            $paths[] = $relative;
            if (count($paths) >= self::MAX_FILES) {
                break;
            }
        }

        return $this->buildIndexed($sandboxPath, $paths);
    }

    /**
     * Scan only known project files (fast path for local-linked large trees).
     *
     * @param  list<string>  $relativePaths
     * @return list<array{from: string, to: string, kind: string, line: int|null}>
     */
    public function buildIndexed(string $sandboxPath, array $relativePaths): array
    {
        $edges = [];
        $root = rtrim(str_replace('\\', '/', $sandboxPath), '/');
        $count = 0;

        foreach ($relativePaths as $relative) {
            $relative = ltrim(str_replace('\\', '/', $relative), '/');
            if ($relative === '' || $this->ignore->shouldSkip($relative)) {
                continue;
            }

            $ext = strtolower(pathinfo($relative, PATHINFO_EXTENSION));
            if (! in_array($ext, self::EXTENSIONS, true)) {
                continue;
            }
            if (++$count > self::MAX_FILES) {
                break;
            }

            $absolute = $root.'/'.$relative;
            if (! is_file($absolute)) {
                continue;
            }

            $source = @file_get_contents($absolute);
            if ($source === false || strlen($source) > 512_000) {
                continue;
            }

            foreach (match ($ext) {
                'php' => $this->phpEdges($relative, $source),
                'html', 'htm' => $this->htmlEdges($relative, $source),
                default => $this->jsEdges($relative, $source),
            } as $edge) {
                $edges[] = $edge;
            }
        }

        return $edges;
    }

    /**
     * @return list<array{from: string, to: string, kind: string, line: int|null}>
     */
    private function phpEdges(string $from, string $source): array
    {
        $edges = [];
        $lines = preg_split("/\r\n|\n|\r/", $source) ?: [];
        foreach ($lines as $i => $line) {
            $lineNo = $i + 1;
            if (preg_match('/^\s*use\s+([A-Za-z0-9_\\\\]+)/', $line, $m)) {
                $edges[] = [
                    'from' => $from,
                    'to' => 'php:'.$m[1],
                    'kind' => 'import',
                    'line' => $lineNo,
                ];
            }
            if (preg_match('/\b(?:require|include)(?:_once)?\s*\(?\s*[\'"]([^\'"]+)[\'"]/', $line, $m)) {
                $edges[] = [
                    'from' => $from,
                    'to' => $this->resolveRelative($from, $m[1]),
                    'kind' => 'import',
                    'line' => $lineNo,
                ];
            }
        }

        return $edges;
    }

    /**
     * @return list<array{from: string, to: string, kind: string, line: int|null}>
     */
    private function jsEdges(string $from, string $source): array
    {
        $edges = [];
        $lines = preg_split("/\r\n|\n|\r/", $source) ?: [];
        foreach ($lines as $i => $line) {
            $lineNo = $i + 1;
            if (preg_match('/\bfrom\s+[\'"]([^\'"]+)[\'"]/', $line, $m)
                || preg_match('/\bimport\s*\(\s*[\'"]([^\'"]+)[\'"]\s*\)/', $line, $m)
                || preg_match('/\brequire\s*\(\s*[\'"]([^\'"]+)[\'"]\s*\)/', $line, $m)) {
                $target = $m[1];
                $to = str_starts_with($target, '.') || str_starts_with($target, '/')
                    ? $this->resolveRelative($from, $target)
                    : 'pkg:'.$target;
                $edges[] = [
                    'from' => $from,
                    'to' => $to,
                    'kind' => 'import',
                    'line' => $lineNo,
                ];
            }
        }

        return $edges;
    }

    /**
     * @return list<array{from: string, to: string, kind: string, line: int|null}>
     */
    private function htmlEdges(string $from, string $source): array
    {
        $edges = [];
        if (preg_match_all('/\b(?:src|href)\s*=\s*[\'"]([^\'"#?]+)[\'"]/i', $source, $matches, PREG_SET_ORDER)) {
            foreach ($matches as $m) {
                $target = $m[1];
                if ($target === '' || str_starts_with($target, 'data:') || str_starts_with($target, 'mailto:')) {
                    continue;
                }
                $to = str_starts_with($target, 'http://') || str_starts_with($target, 'https://') || str_starts_with($target, '//')
                    ? 'pkg:'.$target
                    : $this->resolveRelative($from, $target);
                // Contract C3's kind enum has no 'link'; an HTML src/href
                // reference is the page including another resource.
                $edges[] = [
                    'from' => $from,
                    'to' => $to,
                    'kind' => 'include',
                ];
            }
        }

        return $edges;
    }

    private function resolveRelative(string $from, string $ref): string
    {
        $dir = str_replace('\\', '/', dirname($from));
        $parts = explode('/', $dir.'/'.$ref);
        $stack = [];
        foreach ($parts as $part) {
            if ($part === '' || $part === '.') {
                continue;
            }
            if ($part === '..') {
                array_pop($stack);

                continue;
            }
            $stack[] = $part;
        }

        return implode('/', $stack);
    }
}
