<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Registered analyser adapters (DX-26 / DX-27)
    |--------------------------------------------------------------------------
    |
    | Toggle first-party adapters without code changes. All adapters honour the
    | parse-never-execute invariant: they tokenise or invoke Maintain-owned
    | vendor binaries only — never execute imported project code.
    |
    */

    'phpstan' => (bool) env('DIAGNOSTICS_PHPSTAN', true),

    'js' => (bool) env('DIAGNOSTICS_JS', true),

    /** Parse-only Pest/PHPUnit awareness + missing-test suggestions. */
    'php_test' => (bool) env('DIAGNOSTICS_PHP_TEST', true),

    /** API-owned PHPCS binary (composer dev dependency in apps/api). */
    'phpcs' => (bool) env('DIAGNOSTICS_PHPCS', true),

    /** API-owned PHPMD binary (composer dev dependency in apps/api). */
    'phpmd' => (bool) env('DIAGNOSTICS_PHPMD', true),

];
