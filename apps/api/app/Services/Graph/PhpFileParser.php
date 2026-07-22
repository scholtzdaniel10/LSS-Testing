<?php

namespace App\Services\Graph;

/**
 * IG-22: PHP file parser — extracts `use` imports and require/include calls.
 */
final class PhpFileParser implements FileParser
{
    public function extensions(): array
    {
        return ['php'];
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
            if (preg_match('/(?:^|<\?php|;|\{)\s*use\s+([A-Za-z0-9_\\\\]+)/', $line, $m)) {
                $edges[] = [
                    'from' => $relativePath,
                    'to' => 'php:'.$m[1],
                    'kind' => 'import',
                    'line' => $lineNo,
                ];
            }
            if (preg_match('/\b(?:require|include)(?:_once)?\s*\(?\s*[\'"]([^\'"]+)[\'"]/', $line, $m)) {
                $edges[] = [
                    'from' => $relativePath,
                    'to' => $this->resolveRelative($relativePath, $m[1]),
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
