<?php

use App\Support\Sandbox\IgnoreRules;

it('skips .phpunit.cache (IG-27: PHPUnit 10+ cache dir, same class as coverage/test-results)', function () {
    $rules = IgnoreRules::fromConfig();

    expect($rules->shouldSkip('.phpunit.cache/code-coverage/abc123'))->toBeTrue()
        ->and($rules->shouldSkip('.phpunit.cache/test-results'))->toBeTrue();
});

it('still keeps real project files alongside a .phpunit.cache dir', function () {
    $rules = IgnoreRules::fromConfig();

    expect($rules->shouldSkip('tests/Unit/ExampleTest.php'))->toBeFalse()
        ->and($rules->shouldSkip('src/App.php'))->toBeFalse();
});
