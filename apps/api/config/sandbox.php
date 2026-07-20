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
    ],

];
