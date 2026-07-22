<?php

namespace App\Services\Diagnostics;

/**
 * DX-7: join C5 errors onto the C3 edge list.
 *
 * Given the graph edges of a scan, resolves for any file:
 *  - upstream:   what the file directly depends on (possible causes),
 *  - downstream: which files (transitively) depend on it (blast radius).
 *
 * v1 is file-level only: edges carry no `symbol` yet, so symbol-level
 * resolution (the C5 ideal) degrades honestly to file-level. When parsers
 * start emitting `symbol` on edges, this class is the single place to
 * upgrade.
 *
 * Pure and DB-free: construct once per scan from the in-memory edge list,
 * query many times.
 */
final class ImpactResolver
{
    public const DEFAULT_DEPTH = 3;

    /** @var array<string, list<string>> file => files it depends on */
    private array $dependsOn = [];

    /** @var array<string, list<string>> file => files that depend on it */
    private array $dependedOnBy = [];

    /**
     * @param  list<array{from: string, to: string, kind?: string, line?: int|null}>  $edges
     */
    public function __construct(array $edges)
    {
        foreach ($edges as $edge) {
            $from = $this->normalize($edge['from'] ?? '');
            $to = $this->normalize($edge['to'] ?? '');
            if ($from === '' || $to === '' || $from === $to) {
                continue;
            }
            $this->dependsOn[$from][] = $to;
            $this->dependedOnBy[$to][] = $from;
        }

        foreach ($this->dependsOn as $file => $targets) {
            $this->dependsOn[$file] = array_values(array_unique($targets));
        }
        foreach ($this->dependedOnBy as $file => $sources) {
            $this->dependedOnBy[$file] = array_values(array_unique($sources));
        }
    }

    /**
     * Direct dependencies of $file — candidates for the error's cause.
     *
     * @return list<string>
     */
    public function upstream(string $file): array
    {
        return $this->dependsOn[$this->normalize($file)] ?? [];
    }

    /**
     * Files that (transitively) depend on $file, breadth-first over reverse
     * edges, capped at $depth hops to bound cost on large graphs
     * (pilot: ~6.2k edges). Deduped; never contains $file itself.
     *
     * @return list<string>
     */
    public function downstream(string $file, int $depth = self::DEFAULT_DEPTH): array
    {
        $start = $this->normalize($file);
        $seen = [$start => true];
        $result = [];
        $frontier = [$start];

        for ($hop = 0; $hop < $depth && $frontier !== []; $hop++) {
            $next = [];
            foreach ($frontier as $current) {
                foreach ($this->dependedOnBy[$current] ?? [] as $dependent) {
                    if (isset($seen[$dependent])) {
                        continue;
                    }
                    $seen[$dependent] = true;
                    $result[] = $dependent;
                    $next[] = $dependent;
                }
            }
            $frontier = $next;
        }

        return $result;
    }

    private function normalize(string $path): string
    {
        return ltrim(str_replace('\\', '/', $path), '/');
    }
}
