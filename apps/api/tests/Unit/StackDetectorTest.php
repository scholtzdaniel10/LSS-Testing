<?php

use App\Services\Import\StackDetector;

/**
 * DX-31: builds a throwaway sandbox directory for flag combinations that
 * don't need a checked-in fixture, and removes it after the test runs.
 */
function stackDetectorSandbox(array $files): string
{
    $root = sys_get_temp_dir().DIRECTORY_SEPARATOR.'stack-detector-'.uniqid();
    mkdir($root, 0777, true);

    foreach ($files as $relativePath => $contents) {
        $path = $root.DIRECTORY_SEPARATOR.str_replace('/', DIRECTORY_SEPARATOR, $relativePath);
        if (! is_dir(dirname($path))) {
            mkdir(dirname($path), 0777, true);
        }
        file_put_contents($path, $contents);
    }

    return $root;
}

function stackDetectorCleanup(string $root): void
{
    $items = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::CHILD_FIRST
    );
    foreach ($items as $item) {
        $item->isDir() ? rmdir($item->getPathname()) : unlink($item->getPathname());
    }
    rmdir($root);
}

it('flags application/+system/ as legacy PHP layout without claiming CodeIgniter (DX-31)', function () {
    $profile = (new StackDetector)->detect(base_path('tests/fixtures/legacy-php-custom'));

    expect($profile->isLegacyPhpLayout)->toBeTrue()
        ->and($profile->isCi3)->toBeFalse();
});

it('detects genuine CodeIgniter 3 via the CI_VERSION marker in system/core/CodeIgniter.php', function () {
    $profile = (new StackDetector)->detect(base_path('tests/fixtures/ci3-mini'));

    expect($profile->isLegacyPhpLayout)->toBeTrue()
        ->and($profile->isCi3)->toBeTrue();
});

it('does not flag legacy PHP layout when composer.json is present, even with application/+system/ dirs', function () {
    $root = stackDetectorSandbox([
        'application/controllers/Home.php' => '<?php class Home {}',
        'system/Bootstrap.php' => '<?php class Bootstrap {}',
        'composer.json' => '{"name": "acme/app"}',
    ]);

    $profile = (new StackDetector)->detect($root);
    stackDetectorCleanup($root);

    expect($profile->hasComposer)->toBeTrue()
        ->and($profile->isLegacyPhpLayout)->toBeFalse()
        ->and($profile->isCi3)->toBeFalse();
});

it('does not report isCi3 when CodeIgniter.php exists but lacks the CI_VERSION marker', function () {
    $root = stackDetectorSandbox([
        'application/controllers/Home.php' => '<?php class Home {}',
        'system/core/CodeIgniter.php' => '<?php // not actually CodeIgniter',
    ]);

    $profile = (new StackDetector)->detect($root);
    stackDetectorCleanup($root);

    expect($profile->isLegacyPhpLayout)->toBeTrue()
        ->and($profile->isCi3)->toBeFalse();
});

it('detects hasComposer from composer.json', function () {
    $root = stackDetectorSandbox(['composer.json' => '{}']);

    $profile = (new StackDetector)->detect($root);
    stackDetectorCleanup($root);

    expect($profile->hasComposer)->toBeTrue();
});

it('detects hasPackage and hasAngular from package.json + angular.json', function () {
    $root = stackDetectorSandbox([
        'package.json' => '{}',
        'angular.json' => '{}',
    ]);

    $profile = (new StackDetector)->detect($root);
    stackDetectorCleanup($root);

    expect($profile->hasPackage)->toBeTrue()
        ->and($profile->hasAngular)->toBeTrue();
});

it('detects hasPlaywright from playwright.config.ts', function () {
    $root = stackDetectorSandbox(['playwright.config.ts' => 'export default {};']);

    $profile = (new StackDetector)->detect($root);
    stackDetectorCleanup($root);

    expect($profile->hasPlaywright)->toBeTrue();
});

it('detects hasPlaywright from playwright.config.js', function () {
    $root = stackDetectorSandbox(['playwright.config.js' => 'module.exports = {};']);

    $profile = (new StackDetector)->detect($root);
    stackDetectorCleanup($root);

    expect($profile->hasPlaywright)->toBeTrue();
});
