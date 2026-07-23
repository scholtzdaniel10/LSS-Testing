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
        Cache::forget("graph:{$projectId}");
        Cache::forget("tree:{$projectId}");
        Cache::forget("usage:{$projectId}");
        Cache::forget("health:{$projectId}:latest");
        Cache::forget("bootstrap:{$projectId}");
        Cache::forget("size:{$projectId}");
    }

    public static function forgetGraph(string $projectId): void
    {
        Cache::forget("graph:{$projectId}");
        Cache::forget("bootstrap:{$projectId}");
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
}
