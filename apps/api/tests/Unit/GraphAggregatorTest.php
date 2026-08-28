<?php

use App\Services\Graph\GraphAggregator;

function overviewFixtureFiles(): array
{
    $files = [];
    for ($i = 0; $i < 100; $i++) {
        $files[] = "src/f{$i}.ts";
    }

    return $files;
}

/** Same keep set hugeGraphOverviewKeep produces for the 100-file / fileCap=20 fixture. */
function overviewFixtureKeptFiles(): array
{
    return [
        'src/f0.ts',
        'src/f1.ts', 'src/f10.ts', 'src/f11.ts', 'src/f12.ts', 'src/f13.ts',
        'src/f14.ts', 'src/f15.ts', 'src/f16.ts', 'src/f17.ts', 'src/f18.ts',
        'src/f19.ts', 'src/f2.ts', 'src/f20.ts', 'src/f21.ts', 'src/f22.ts',
        'src/f23.ts', 'src/f24.ts', 'src/f25.ts', 'src/f26.ts', 'src/f27.ts',
    ];
}

it('matches hugeGraphOverviewKeep file selection and keeps the collapsed folder hub', function () {
    $files = overviewFixtureFiles();
    $view = (new GraphAggregator)->overview([], $files, ['src/f0.ts' => 1], 20);

    $ids = array_column($view['nodes'], 'id');
    sort($ids);

    $expectedFiles = overviewFixtureKeptFiles();
    $expected = [...$expectedFiles, 'dir:src'];
    sort($expected);

    $fileIds = array_values(array_filter($ids, fn (string $id): bool => ! str_starts_with($id, 'dir:')));
    sort($fileIds);
    $expectedFileIds = $expectedFiles;
    sort($expectedFileIds);

    expect($fileIds)->toBe($expectedFileIds)
        ->and($ids)->toBe($expected)
        ->and($view['nodes'])->toHaveCount(22)
        ->and($view['total'])->toBe(101)
        ->and($view['returned'])->toBe(22)
        ->and($view['truncated'])->toBeTrue()
        ->and($view['cap'])->toBe(20);

    $errorNode = collect($view['nodes'])->firstWhere('id', 'src/f0.ts');
    expect($errorNode['errors'])->toBe(1)
        ->and($errorNode['kind'])->toBe('file');

    $hub = collect($view['nodes'])->firstWhere('id', 'dir:src');
    expect($hub['kind'])->toBe('folder')
        ->and($hub['folderPath'])->toBe('src')
        ->and($hub['fileCount'])->toBe(100)
        ->and($hub['errors'])->toBe(1)
        ->and($hub['folder'])->toBe('src');
});

it('does not treat limit as a total cap that drops folder hubs', function () {
    $files = [
        'app/A.php', 'app/B.php',
        'lib/C.php', 'lib/D.php',
        'system/E.php',
    ];
    $view = (new GraphAggregator)->overview([], $files, [], 1);

    $ids = array_column($view['nodes'], 'id');
    expect($ids)->toContain('dir:app', 'dir:lib', 'dir:system')
        ->and($view['returned'])->toBeGreaterThan($view['cap'])
        ->and($view['truncated'])->toBeTrue();
});

it('ranks remaining files by degree desc then id, always keeping error files', function () {
    $files = ['app/hub.php', 'app/a.php', 'app/b.php', 'app/quiet.php'];
    $edges = [
        ['from' => 'app/hub.php', 'to' => 'app/a.php', 'kind' => 'import'],
        ['from' => 'app/hub.php', 'to' => 'app/b.php', 'kind' => 'import'],
        ['from' => 'app/hub.php', 'to' => 'app/quiet.php', 'kind' => 'import'],
    ];
    $view = (new GraphAggregator)->overview($edges, $files, ['app/quiet.php' => 2], 1);

    $ids = array_column($view['nodes'], 'id');
    expect($ids)->toContain('dir:app', 'app/quiet.php', 'app/hub.php')
        ->and($ids)->not->toContain('app/a.php')
        ->and($ids)->not->toContain('app/b.php');

    $hub = collect($view['nodes'])->firstWhere('id', 'app/hub.php');
    expect($hub['degree'])->toBe(3);
});

it('collapses inter-folder edges and weights them like buildGraphView', function () {
    $files = ['app/A.php', 'app/B.php', 'lib/C.php', 'lib/D.php'];
    $edges = [
        ['from' => 'app/A.php', 'to' => 'lib/C.php', 'kind' => 'import'],
        ['from' => 'app/B.php', 'to' => 'lib/D.php', 'kind' => 'import'],
    ];
    $view = (new GraphAggregator)->overview($edges, $files, [], 0);

    $ids = array_column($view['nodes'], 'id');
    expect($ids)->toEqualCanonicalizing(['dir:app', 'dir:lib'])
        ->and($view['links'])->toHaveCount(1)
        ->and($view['links'][0]['source'])->toBe('dir:app')
        ->and($view['links'][0]['target'])->toBe('dir:lib')
        ->and($view['links'][0]['weight'])->toBe(2)
        ->and($view['links'][0]['externalTarget'])->toBeFalse()
        ->and($view['truncated'])->toBeTrue();
});

it('hides external refs (showExternal=false) and does not emit color or positions', function () {
    $files = ['app/A.php'];
    $edges = [
        ['from' => 'app/A.php', 'to' => 'pkg:guzzlehttp/guzzle', 'kind' => 'import'],
        ['from' => 'app/A.php', 'to' => 'php:App\\Models\\Invoice', 'kind' => 'import'],
        ['from' => 'app/A.php', 'to' => 'npm:lodash', 'kind' => 'import'],
        ['from' => 'app/A.php', 'to' => 'ext:redis', 'kind' => 'import'],
    ];
    $view = (new GraphAggregator)->overview($edges, $files, [], 40);

    foreach ($view['nodes'] as $node) {
        expect($node)->not->toHaveKey('color')
            ->and($node)->not->toHaveKey('x')
            ->and($node)->not->toHaveKey('y')
            ->and($node)->not->toHaveKey('fx')
            ->and($node)->not->toHaveKey('fy')
            ->and($node['external'])->toBeFalse();
    }
    expect($view['links'])->toBe([]);
});

it('copies folderOf allowlist exactly', function () {
    expect(GraphAggregator::folderOf('app/X.php'))->toBe('app')
        ->and(GraphAggregator::folderOf('application/X.php'))->toBe('application')
        ->and(GraphAggregator::folderOf('lib/X.php'))->toBe('lib')
        ->and(GraphAggregator::folderOf('components/X.tsx'))->toBe('components')
        ->and(GraphAggregator::folderOf('pages/X.tsx'))->toBe('pages')
        ->and(GraphAggregator::folderOf('services/X.php'))->toBe('services')
        ->and(GraphAggregator::folderOf('vendor/X.php'))->toBe('other');
});

it('detects pkg/php/npm/ext external prefixes', function () {
    expect(GraphAggregator::isExternalRef('pkg:guzzlehttp/guzzle'))->toBeTrue()
        ->and(GraphAggregator::isExternalRef('php:App\\Foo'))->toBeTrue()
        ->and(GraphAggregator::isExternalRef('npm:react'))->toBeTrue()
        ->and(GraphAggregator::isExternalRef('ext:pdo'))->toBeTrue()
        ->and(GraphAggregator::isExternalRef('app/A.php'))->toBeFalse();
});
