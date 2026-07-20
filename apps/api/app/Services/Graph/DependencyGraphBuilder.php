<?php

namespace App\Services\Graph;

/**
 * IG-8/9/10 minimal: extract file-level import/require edges from PHP and JS/TS.
 * Emits C3 edges; symbol omitted when unknown (file-level fallback).
 */
final class DependencyGraphBuilder
{
    private const MAX_FILES = 4000;

    /**
     * @return list<array{from: string, to: string, kind: string, line: int|null}>
     */
    public function build(string $sandboxPath): array
    {
        $edges = [];
        $count = 0;
        $iterator = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($sandboxPath, \FilesystemIterator::SKIP_DOTS),
        );

        foreach ($iterator as $file) {
            if (! $file->isFile()) {
                continue;
            }
            $ext = strtolower($file->getExtension());
            if (! in_array($ext, ['php', 'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx'], true)) {
                continue;
            }
            if (++$count > self::MAX_FILES) {
                break;
            }

            $absolute = $file->getPathname();
            $relative = ltrim(str_replace('\\', '/', substr($absolute, strlen($sandboxPath))), '/');
            $source = @file_get_contents($absolute);
            if ($source === false || strlen($source) > 512_000) {
                continue;
            }

            $edges = array_merge($edges, match ($ext) {
                'php' => $this->phpEdges($relative, $source),
                default => $this->jsEdges($relative, $source),
            });
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
