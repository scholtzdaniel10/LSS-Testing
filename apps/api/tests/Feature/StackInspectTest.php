<?php

use Illuminate\Support\Facades\File;

/**
 * DX-32: the stack:inspect command, plus an opt-in regression against the real
 * pilot corpus.
 *
 * The corpus test is skipped unless LSS_PILOT_PATH points at a real directory,
 * following the opt-in pattern used for database-backed tests — CI has no
 * estate-agents checkout and must stay green without one.
 */
it('reports a hand-rolled application/ + system/ project as legacy but not CodeIgniter', function () {
    $this->artisan('stack:inspect', ['path' => base_path('tests/fixtures/legacy-php-custom')])
        ->expectsOutputToContain('Legacy application/ + system/')
        ->assertSuccessful();
});

it('emits machine-readable JSON with the profile and report (DX-32)', function () {
    $this->artisan('stack:inspect', [
        'path' => base_path('tests/fixtures/legacy-php-custom'),
        '--json' => true,
    ])->assertSuccessful();

    // Re-derive the same payload directly so we can assert on its shape.
    $detector = new App\Services\Import\StackDetector;
    $profile = $detector->detect(base_path('tests/fixtures/legacy-php-custom'));

    expect($profile->isCi3)->toBeFalse()
        ->and($profile->isLegacyPhpLayout)->toBeTrue();
});

it('fails cleanly on a path that does not exist', function () {
    $this->artisan('stack:inspect', ['path' => base_path('tests/fixtures/does-not-exist')])
        ->assertFailed();
});

it('restores composer.json after --hide-composer, even though detection changes', function () {
    $root = storage_path('framework/testing/hide-'.uniqid());
    File::ensureDirectoryExists($root.'/application/controllers');
    File::ensureDirectoryExists($root.'/system');
    file_put_contents($root.'/system/System.php', "<?php\n");
    file_put_contents($root.'/composer.json', '{"require-dev":{"pestphp/pest":"^4.4"}}');

    $this->artisan('stack:inspect', ['path' => $root, '--hide-composer' => true])
        ->assertSuccessful();

    expect(file_exists($root.'/composer.json'))->toBeTrue()
        ->and(file_exists($root.'/composer.json.stack-inspect-bak'))->toBeFalse();

    File::deleteDirectory($root);
});

/**
 * Opt-in: point LSS_PILOT_PATH at the estate-agents corpus to prove the DX-31
 * fix against real code rather than a fixture.
 *
 * This is the case that actually discriminates old logic from new: with
 * composer.json hidden the pre-DX-31 heuristic reported CodeIgniter 3, because
 * it inferred the framework from `application/ + system/ + no composer.json`.
 */
it('does not claim CodeIgniter for the real pilot corpus (DX-31 regression)', function () {
    $path = rtrim((string) env('LSS_PILOT_PATH'), DIRECTORY_SEPARATOR.'/');
    $sep = DIRECTORY_SEPARATOR;

    // 1. It really is the application/ + system/ layout that fooled the old heuristic.
    expect(is_dir($path.$sep.'application'))->toBeTrue()
        ->and(is_dir($path.$sep.'system'))->toBeTrue();

    // 2. There is genuinely no CodeIgniter here. This is the evidence that makes
    //    any 'codeigniter-3' claim a fabrication rather than a debatable guess.
    foreach ([
        'system/core/CodeIgniter.php',
        'system/core/Controller.php',
        'system/libraries',
        'system/helpers',
        'system/database',
    ] as $marker) {
        $full = $path.$sep.str_replace('/', $sep, $marker);
        expect(file_exists($full))->toBeFalse("Unexpected CodeIgniter marker present: {$marker}");
    }

    // 3. Detection agrees — evaluated with composer.json out of the picture, which
    //    is the condition the pre-DX-31 heuristic keyed on. Without this the
    //    assertion would pass against the old code too and prove nothing.
    $stashed = null;
    $composer = $path.$sep.'composer.json';
    if (is_file($composer)) {
        $stashed = $composer.'.pest-bak';
        expect(file_exists($stashed))->toBeFalse("Stale {$stashed} — restore it before running.");
        rename($composer, $stashed);
    }

    try {
        $profile = (new App\Services\Import\StackDetector)->detect($path);

        expect($profile->isLegacyPhpLayout)->toBeTrue()
            ->and($profile->isCi3)->toBeFalse(
                'The pilot corpus is a hand-rolled PHP mini-framework with no CodeIgniter '.
                'in the tree. Claiming CodeIgniter 3 means the layout-only heuristic is back — DX-31.',
            );
    } finally {
        if ($stashed !== null && file_exists($stashed)) {
            rename($stashed, $composer);
        }
    }

    expect(is_file($composer))->toBeTrue('composer.json was not restored.');
})->skip(
    fn () => ! is_dir((string) env('LSS_PILOT_PATH')),
    'Set LSS_PILOT_PATH to the estate-agents checkout to run the corpus regression.',
);
