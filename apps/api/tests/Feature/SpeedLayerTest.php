<?php

use App\Services\Diagnostics\PhpStanAdapter;
use App\Services\Graph\DependencyGraphBuilder;
use App\Services\Graph\IncrementalGraphBuilder;
use App\Support\Sandbox\IgnoreRules;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Str;

it('plans CI3 shards as application child dirs (Wave A)', function () {
    $root = storage_path('framework/testing/shards-'.uniqid());
    File::ensureDirectoryExists($root.'/application/controllers');
    File::ensureDirectoryExists($root.'/application/models');
    File::ensureDirectoryExists($root.'/system/core');
    file_put_contents($root.'/application/controllers/Welcome.php', "<?php\n");

    config(['speed.phpstan_deep' => false, 'speed.phpstan_progressive' => false]);
    $adapter = new PhpStanAdapter;
    $shards = $adapter->planShards($root);

    expect($shards)->not->toBeEmpty()
        ->and(collect($shards)->pluck('label')->all())->toContain('application/controllers')
        ->and(collect($shards)->pluck('label')->all())->not->toContain('system');

    File::deleteDirectory($root);
});

it('progressive first-pass defers low-priority dirs over file budget', function () {
    $root = storage_path('framework/testing/prog-'.uniqid());
    File::ensureDirectoryExists($root.'/application/controllers');
    File::ensureDirectoryExists($root.'/application/models');
    File::ensureDirectoryExists($root.'/application/views');
    for ($i = 0; $i < 30; $i++) {
        file_put_contents($root.'/application/controllers/C'.$i.'.php', "<?php\n");
        file_put_contents($root.'/application/models/M'.$i.'.php', "<?php\n");
        file_put_contents($root.'/application/views/V'.$i.'.php', "<?php\n");
    }

    config([
        'speed.phpstan_deep' => false,
        'speed.phpstan_progressive' => true,
        'speed.phpstan_first_pass_max_files' => 50,
    ]);
    $adapter = new PhpStanAdapter;
    $shards = $adapter->planShards($root);
    $labels = collect($shards)->pluck('label')->all();
    $deferred = collect($adapter->deferredShards())->pluck('label')->all();

    expect($labels)->toContain('application/controllers')
        ->and($deferred)->not->toBeEmpty()
        ->and($deferred)->toContain('application/views');

    File::deleteDirectory($root);
});

it('reuses cached per-file edges when content hash is unchanged', function () {
    Cache::flush();
    $root = storage_path('framework/testing/inc-graph-'.uniqid());
    File::ensureDirectoryExists($root);
    $file = $root.'/A.php';
    file_put_contents($file, "<?php\nrequire 'B.php';\n");

    $builder = new IncrementalGraphBuilder(new DependencyGraphBuilder(IgnoreRules::fromConfig()));
    $projectId = (string) Str::uuid();

    $first = $builder->buildIndexed($projectId, $root, ['A.php']);
    $second = $builder->buildIndexed($projectId, $root, ['A.php']);

    expect($second)->toEqual($first)
        ->and($builder->lastChangedPaths($projectId))->toBe([]);

    file_put_contents($file, "<?php\nrequire 'C.php';\n");
    $third = $builder->buildIndexed($projectId, $root, ['A.php']);
    expect($builder->lastChangedPaths($projectId))->toContain('A.php')
        ->and($third)->not->toEqual($first);

    File::deleteDirectory($root);
});

it('filters graph paths by parseable langs', function () {
    $builder = new DependencyGraphBuilder(IgnoreRules::fromConfig());
    expect($builder->parseableLangs())->toContain('php')
        ->and($builder->parseableLangs())->toContain('javascript')
        ->and($builder->parseableExtensions())->toContain('php');
});
