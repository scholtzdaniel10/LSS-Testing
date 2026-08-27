<?php

namespace App\Services\Graph;

/**
 * IG-22: HTML file parser — extracts src/href links from script/link/img tags.
 */
final class HtmlFileParser implements FileParser
{
    public function extensions(): array
    {
        return ['html', 'htm'];
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function parse(string $relativePath, string $source): array
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
                    : $this->resolveRelative($relativePath, $target);
                // C3: omit `line` when unknown (integer min 1; null is invalid).
                $edges[] = [
                    'from' => $relativePath,
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
