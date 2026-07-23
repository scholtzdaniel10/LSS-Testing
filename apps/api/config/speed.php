<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Speed layer (Tier 1 works without Redis; Tier 2/3 turn Redis on)
    |--------------------------------------------------------------------------
    */

    'cache_ttl_minutes' => (int) env('SPEED_CACHE_TTL_MINUTES', 30),

    /*
    | Progressive PHPStan: shard directories, flush findings after each shard.
    */
    'phpstan_shards' => (bool) env('PHPSTAN_SHARDS', true),

    /*
    | CI3 Wave B: include system/ in PHPStan. Default false = application only.
    */
    'phpstan_deep' => (bool) env('PHPSTAN_DEEP', false),

    /*
    | Persist PHPStan result cache under storage/framework/phpstan/{projectKey}.
    */
    'phpstan_cache_dir' => (bool) env('PHPSTAN_CACHE_DIR', true),

    /*
    | neon parallel.maximumNumberOfProcesses (0 = auto max(2, CPU-1)).
    */
    'phpstan_parallel' => (int) env('PHPSTAN_PARALLEL', 0),

    /*
    | Incremental graph: only reparse files whose content hash changed (Cache-backed).
    */
    'incremental_graph' => (bool) env('SPEED_INCREMENTAL_GRAPH', true),

    /*
    | Redis findings buffer (RPUSH then bulk flush). No-op unless redis cache store.
    */
    'findings_buffer' => (bool) env('SPEED_FINDINGS_BUFFER', false),

    /*
    | Skip usage rebuild in Analyze when usage_reports.updated_at >= last_imported_at.
    */
    'skip_stale_usage_rebuild' => (bool) env('SPEED_SKIP_USAGE_REBUILD', true),

];
