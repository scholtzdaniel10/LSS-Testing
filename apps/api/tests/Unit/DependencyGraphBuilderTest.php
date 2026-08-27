<?php

use App\Services\Graph\DependencyGraphBuilder;
use App\Services\Graph\FileParser;
use App\Support\Sandbox\IgnoreRules;

it('extracts html script and stylesheet links', function () {
    $root = sys_get_temp_dir().'/lss-graph-'.uniqid('', true);
    mkdir($root, 0777, true);
    file_put_contents($root.'/index.html', '<html><head><link href="deeltitel.css" rel="stylesheet"></head>'
        .'<body><script src="finwaardes.js"></script></body></html>');

    $edges = (new DependencyGraphBuilder(IgnoreRules::fromConfig()))->build($root);

    expect($edges)->toHaveCount(2)
        ->and(collect($edges)->pluck('to')->all())->toContain('deeltitel.css', 'finwaardes.js');

    foreach ($edges as $edge) {
        expect($edge)->not->toHaveKey('line')
            ->and($edge['kind'])->toBe('include');
    }

    array_map('unlink', glob($root.'/*') ?: []);
    rmdir($root);
});

// ── IG-22: FileParser registry tests ─────────────────────────────────────────

it('builder dispatches to registered parsers by extension (IG-22)', function () {
    $root = sys_get_temp_dir().'/lss-graph-'.uniqid('', true);
    mkdir($root, 0777, true);
    file_put_contents($root.'/index.html', '<html><head><link href="style.css" rel="stylesheet"></head></html>');
    file_put_contents($root.'/main.php', '<?php use App\Foo;');
    file_put_contents($root.'/app.js', "import './helper';");

    $builder = new DependencyGraphBuilder(IgnoreRules::fromConfig());
    $edges = $builder->build($root);

    $froms = array_column($edges, 'from');
    expect(in_array('index.html', $froms))->toBeTrue('HTML parser should run')
        ->and(in_array('main.php', $froms))->toBeTrue('PHP parser should run')
        ->and(in_array('app.js', $froms))->toBeTrue('JS parser should run');

    array_map('unlink', glob($root.'/*') ?: []);
    rmdir($root);
});

it('adding a custom parser via registerParser needs no runner edit (IG-22)', function () {
    // A trivial FileParser that handles .cfg files.
    $cfgParser = new class implements FileParser
    {
        public function extensions(): array
        {
            return ['cfg'];
        }

        public function parse(string $path, string $source): array
        {
            return [['from' => $path, 'to' => 'pkg:config-dep', 'kind' => 'import', 'line' => 1]];
        }
    };

    $root = sys_get_temp_dir().'/lss-graph-'.uniqid('', true);
    mkdir($root, 0777, true);
    file_put_contents($root.'/app.cfg', 'dep=something');

    $builder = new DependencyGraphBuilder(IgnoreRules::fromConfig());
    // Before registration: no edges
    expect($builder->build($root))->toBe([]);

    // After registration: cfg file is parsed without touching DependencyGraphBuilder's code
    $builder->registerParser($cfgParser);
    $edges = $builder->build($root);
    expect($edges)->toHaveCount(1)
        ->and($edges[0]['to'])->toBe('pkg:config-dep');

    @unlink($root.'/app.cfg');
    @rmdir($root);
});
