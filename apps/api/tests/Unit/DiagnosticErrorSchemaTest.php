<?php

use App\Services\Diagnostics\Taxonomy;

it('C5 source is a validated string not a closed enum (DX-22)', function () {
    $schemaPath = dirname(base_path(), 2).'/packages/schemas/diagnostic-error.schema.json';
    $schema = json_decode((string) file_get_contents($schemaPath), true);

    expect($schema)->toBeArray()
        ->and($schema['properties']['source']['type'] ?? null)->toBe('string')
        ->and($schema['properties']['source'])->not->toHaveKey('enum');
});

it('classifies phpstan, eslint and tsc ruleIds from the taxonomy (DX-22)', function () {
    $taxonomy = new Taxonomy;

    $php = $taxonomy->classify('phpstan', 'argument.type', 'raw');
    $eslint = $taxonomy->classify('eslint', 'no-unused-vars', 'raw');
    $tsc = $taxonomy->classify('tsc', 'TS2322', 'raw');

    expect($php['kind'])->toBe('type-error')
        ->and($eslint['kind'])->toBe('unused')
        ->and($tsc['kind'])->toBe('type-error');
});
