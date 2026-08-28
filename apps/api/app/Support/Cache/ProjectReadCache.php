<?php

namespace App\Support\Cache;

use App\Models\Project;
use Illuminate\Support\Facades\Cache;

/**
 * Project read-through caches (file/database/redis). Postgres/SQLite remain SoT.
 */
final class ProjectReadCache
{
    public static function ttl(): \DateTimeInterface
    {
        return now()->addMinutes((int) config('speed.cache_ttl_minutes', 30));
    }

    public static function forgetProject(string $projectId): void
    {
        self::forgetGraph($projectId);
        Cache::forget("tree:{$projectId}");
        Cache::forget("usage:{$projectId}");
        Cache::forget("health:{$projectId}:latest");
        Cache::forget("size:{$projectId}");
    }

    public static function forgetGraph(string $projectId): void
    {
        Cache::forget("graph:{$projectId}");
        Cache::forget("bootstrap:{$projectId}");
        self::forgetIndexed("graph:{$projectId}:overview");
        self::forgetIndexed("graph:{$projectId}:rollup");
        self::forgetIndexed("graph:{$projectId}:neighbourhood");
    }

    /**
     * File/array cache has no wildcard delete. Track derived buckets under
     * `{prefix}:index` so rescan cannot leave stale slices.
     *
     * @param  callable(): mixed  $resolver
     */
    public static function rememberOverview(string $projectId, int $limit, callable $resolver): mixed
    {
        return self::rememberIndexed("graph:{$projectId}:overview", $limit, $resolver);
    }

    /**
     * @param  callable(): mixed  $resolver
     */
    public static function rememberRollup(string $projectId, int $depth, callable $resolver): mixed
    {
        return self::rememberIndexed("graph:{$projectId}:rollup", $depth, $resolver);
    }

    /**
     * Neighbourhood slices are keyed by radius + focus hash. File/array cache
     * has no wildcard delete, so the index must track every bucket.
     *
     * @param  callable(): mixed  $resolver
     */
    public static function rememberNeighbourhood(string $projectId, int $radius, string $focus, callable $resolver): mixed
    {
        $bucket = $radius.':'.hash('sha256', $focus);

        return self::rememberIndexed("graph:{$projectId}:neighbourhood", $bucket, $resolver);
    }

    public static function forgetHealth(string $projectId): void
    {
        Cache::forget("health:{$projectId}:latest");
        Cache::forget("bootstrap:{$projectId}");
    }

    public static function forgetTree(string $projectId): void
    {
        Cache::forget("tree:{$projectId}");
        Cache::forget("bootstrap:{$projectId}");
        Cache::forget("size:{$projectId}");
    }

    public static function forgetUsage(string $projectId): void
    {
        Cache::forget("usage:{$projectId}");
        Cache::forget("bootstrap:{$projectId}");
    }

    /**
     * @param  callable(): mixed  $resolver
     */
    public static function remember(string $key, callable $resolver): mixed
    {
        return Cache::remember($key, self::ttl(), $resolver);
    }

    public static function put(string $key, mixed $value): void
    {
        Cache::put($key, $value, self::ttl());
    }

    private static function rememberIndexed(string $prefix, int|string $bucket, callable $resolver): mixed
    {
        $indexKey = "{$prefix}:index";
        $index = Cache::get($indexKey, []);
        if (! is_array($index)) {
            $index = [];
        }
        if (! in_array($bucket, $index, true)) {
            $index[] = $bucket;
            Cache::put($indexKey, $index, self::ttl());
        }

        return self::remember("{$prefix}:{$bucket}", $resolver);
    }

    private static function forgetIndexed(string $prefix): void
    {
        $indexKey = "{$prefix}:index";
        $index = Cache::get($indexKey, []);
        if (is_array($index)) {
            foreach ($index as $bucket) {
                Cache::forget("{$prefix}:{$bucket}");
            }
        }
        Cache::forget($indexKey);
    }
}
