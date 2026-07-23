<?php

namespace App\Services\Graph;

use Illuminate\Support\Facades\Cache;

/**
 * Phase 4a: content-addressed per-file edge cache. Reparse only when hash changes.
 */
final class IncrementalGraphBuilder
{
    public function __construct(
        private readonly DependencyGraphBuilder $inner,
    ) {}

    /**
     * @param  list<string>  $relativePaths
     * @return list<array{from: string, to: string, kind: string, line: int|null}>
     */
    public function buildIndexed(string $projectId, string $sandboxPath, array $relativePaths): array
    {
        if (! config('speed.incremental_graph', true)) {
            return $this->inner->buildIndexed($sandboxPath, $relativePaths);
        }

        $root = rtrim(str_replace('\\', '/', $sandboxPath), '/');
        $parseable = $this->inner->parseableExtensions();
        $edges = [];
        $changed = [];

        foreach ($relativePaths as $relative) {
            $relative = ltrim(str_replace('\\', '/', $relative), '/');
            if ($relative === '') {
                continue;
            }
            $ext = strtolower(pathinfo($relative, PATHINFO_EXTENSION));
            if (! in_array($ext, $parseable, true)) {
                continue;
            }

            $absolute = $root.'/'.$relative;
            if (! is_file($absolute)) {
                Cache::forget($this->hashKey($projectId, $relative));
                Cache::forget($this->edgesKey($projectId, $relative));

                continue;
            }

            $hash = hash_file('sha256', $absolute) ?: '';
            $hashKey = $this->hashKey($projectId, $relative);
            $edgesKey = $this->edgesKey($projectId, $relative);
            $prev = Cache::get($hashKey);

            if ($prev === $hash) {
                $cached = Cache::get($edgesKey);
                if (is_array($cached)) {
                    foreach ($cached as $edge) {
                        $edges[] = $edge;
                    }

                    continue;
                }
            }

            $changed[] = $relative;
            $fileEdges = $this->inner->buildIndexed($sandboxPath, [$relative]);
            Cache::put($hashKey, $hash, now()->addDays(30));
            Cache::put($edgesKey, $fileEdges, now()->addDays(30));
            foreach ($fileEdges as $edge) {
                $edges[] = $edge;
            }
        }

        // Touch for metrics / future incremental PHPStan (changed path list).
        Cache::put("filehash:{$projectId}:_changed", $changed, now()->addHour());

        return $edges;
    }

    /**
     * @return list<string>
     */
    public function lastChangedPaths(string $projectId): array
    {
        $changed = Cache::get("filehash:{$projectId}:_changed", []);

        return is_array($changed) ? array_values(array_map('strval', $changed)) : [];
    }

    private function hashKey(string $projectId, string $path): string
    {
        return 'filehash:'.$projectId.':'.hash('sha256', $path);
    }

    private function edgesKey(string $projectId, string $path): string
    {
        return 'edges:'.$projectId.':'.hash('sha256', $path);
    }
}
