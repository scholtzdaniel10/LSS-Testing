<?php

use App\Services\Import\StackDetector;
use Illuminate\Support\Facades\File;

/**
 * DX-31: StackDetector must not claim CodeIgniter 3 without positive evidence.
 *
 * The original heuristic was `application/ && system/ && !composer.json`, which
 * is a folder-layout coincidence rather than proof. It reported CodeIgniter 3
 * for the LexPro estate-agents pilot corpus — a hand-rolled PHP mini-framework
 * with no CodeIgniter anywhere — and that false positive was hand-signed-off
 * during PILOT-2 on 2026-07-20.
 */
it('identifies CodeIgniter 3 from framework marker files', function () {
    $profile = (new StackDetector)->detect(base_path('tests/fixtures/ci3-mini'));

    expect($profile->isCi3)->toBeTrue()
        ->and($profile->isLegacyPhpLayout)->toBeTrue();
});

it('does not claim CodeIgniter 3 for a hand-rolled application/ + system/ framework (DX-31)', function () {
    $profile = (new StackDetector)->detect(base_path('tests/fixtures/legacy-php-custom'));

    // The regression: layout matches, but there is no CodeIgniter in the tree.
    expect($profile->isCi3)->toBeFalse()
        ->and($profile->isLegacyPhpLayout)->toBeTrue();
});

it('keeps the legacy-layout PHPStan strategy independent of framework identity (DX-31)', function () {
    $ci3 = (new StackDetector)->detect(base_path('tests/fixtures/ci3-mini'));
    $custom = (new StackDetector)->detect(base_path('tests/fixtures/legacy-php-custom'));

    // Both need scanDirectories/level-0 handling because neither has an
    // autoloader — that must not depend on recognising the framework.
    expect($ci3->isLegacyPhpLayout)->toBe($custom->isLegacyPhpLayout);
});

it('treats each CodeIgniter system directory as sufficient evidence', function (string $marker) {
    $root = storage_path('framework/testing/stack-'.uniqid());
    File::ensureDirectoryExists($root.'/application/controllers');
    File::ensureDirectoryExists($root.'/system/'.$marker);

    $profile = (new StackDetector)->detect($root);

    expect($profile->isCi3)->toBeTrue();

    File::deleteDirectory($root);
})->with(['libraries', 'helpers', 'database']);

it('stops treating a project as legacy layout once Composer is present', function () {
    $root = storage_path('framework/testing/stack-'.uniqid());
    File::ensureDirectoryExists($root.'/application/controllers');
    File::ensureDirectoryExists($root.'/system');
    file_put_contents($root.'/system/System.php', "<?php\n");

    $before = (new StackDetector)->detect($root);
    file_put_contents($root.'/composer.json', '{"require-dev":{"pestphp/pest":"^4.4"}}');
    $after = (new StackDetector)->detect($root);

    // Adding a dev-only Composer manifest (e.g. a Pest harness) changes the
    // autoloader situation but must never be read as framework identity.
    expect($before->isLegacyPhpLayout)->toBeTrue()
        ->and($after->isLegacyPhpLayout)->toBeFalse()
        ->and($before->isCi3)->toBeFalse()
        ->and($after->isCi3)->toBeFalse();

    File::deleteDirectory($root);
});

it('reports no PHP stack for an unrelated directory', function () {
    $root = storage_path('framework/testing/stack-'.uniqid());
    File::ensureDirectoryExists($root.'/src');

    $profile = (new StackDetector)->detect($root);

    expect($profile->isCi3)->toBeFalse()
        ->and($profile->isLegacyPhpLayout)->toBeFalse()
        ->and($profile->hasComposer)->toBeFalse();

    File::deleteDirectory($root);
});
