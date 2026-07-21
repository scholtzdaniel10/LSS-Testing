<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Sandbox root (PLT-8 / IG-1)
    |--------------------------------------------------------------------------
    |
    | Imported program sources are extracted under this path-jailed root.
    | Relative paths are resolved from the API base path.
    |
    */

    'root' => env('SANDBOX_ROOT', storage_path('app/sandboxes')),

    /*
    |--------------------------------------------------------------------------
    | Max file content bytes streamed by GET .../file (IG-3)
    |--------------------------------------------------------------------------
    */

    'max_file_bytes' => (int) env('SANDBOX_MAX_FILE_BYTES', 512_000),

    /*
    |--------------------------------------------------------------------------
    | Default client-side ignore directory names (mirrored for server unzip)
    |--------------------------------------------------------------------------
    */

    'ignore_dirs' => [
        'node_modules',
        'vendor',
        'dist',
        '.git',
        '.angular',
        'build',
        'coverage',
        '.next',
        'out',
        'tmp',
        'temp',
        '__pycache__',
        'playwright-report',
        'test-results',
        'uploads',
        'storage',
        'cache',
        'logs',
        'log',
        'images',
        'media',
        'backup',
        'backups',
    ],

    /*
    |--------------------------------------------------------------------------
    | Local folder linking (Obsidian-style — API reads disk, no zip upload)
    |--------------------------------------------------------------------------
    |
    | When true, POST /projects/{id}/link-local accepts an absolute path on the
    | same machine as the API. Disable in shared/hosted deployments.
    | Optional LOCAL_PATH_PREFIXES=C:\LSS;C:\Projects restricts allowed roots.
    |
    */

    'allow_local_link' => (bool) env('SANDBOX_ALLOW_LOCAL_LINK', false),

    'local_path_prefixes' => array_values(array_filter(array_map(
        'trim',
        explode(';', (string) env('LOCAL_PATH_PREFIXES', '')),
    ))),

];
