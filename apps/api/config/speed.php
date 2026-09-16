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
    | How many PHPStan shard processes to run at once (separate tmpDirs).
    */
    'phpstan_shard_concurrency' => (int) env('PHPSTAN_SHARD_CONCURRENCY', 4),

    /*
    | First diagnose pass: scope to priority dirs until file budget; deepen later.
    | Keeps Diagnose usable inside the ~60s link→analyze SLA on large trees.
    */
    'phpstan_progressive' => (bool) env('PHPSTAN_PROGRESSIVE', true),

    'phpstan_first_pass_max_files' => (int) env('PHPSTAN_FIRST_PASS_MAX_FILES', 300),

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
    | First Map pass: hash/parse at most this many parseable files (rest deepen later).
    */
    'graph_first_pass_max_files' => (int) env('GRAPH_FIRST_PASS_MAX_FILES', 1500),

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
