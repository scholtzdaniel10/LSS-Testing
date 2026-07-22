<?php

namespace App\Services\Graph;

/**
 * IG-22: JS/TS file parser — extracts ES import / require / dynamic import edges.
 */
final class JsFileParser implements FileParser
{
    public function extensions(): array
    {
        return ['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx'];
    }

    /**
     * @return list<array{from: string, to: string, kind: string, line: int|null}>
     */
    public function parse(string $relativePath, string $source): array
    {
        $edges = [];
        $lines = preg_split("/\r\n|\n|\r/", $source) ?: [];
        foreach ($lines as $i => $line) {
            $lineNo = $i + 1;
            if (preg_match('/\bfrom\s+[\'"]([^\'"]+)[\'"]/', $line, $m)
                || preg_match('/\bimport\s*\(\s*[\'"]([^\'"]+)[\'"]\s*\)/', $line, $m)
                || preg_match('/\brequire\s*\(\s*[\'"]([^\'"]+)[\'"]\s*\)/', $line, $m)
                || preg_match('/^\s*import\s+[\'"]([^\'"]+)[\'"]/', $line, $m)) {
                $target = $m[1];
                $to = str_starts_with($target, '.') || str_starts_with($target, '/')
                    ? $this->resolveRelative($relativePath, $target)
                    : 'pkg:'.$target;
                $edges[] = [
                    'from' => $relativePath,
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
