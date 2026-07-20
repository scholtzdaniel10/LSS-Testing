<?php

use App\Services\Graph\DependencyGraphBuilder;
use App\Support\Sandbox\IgnoreRules;

it('extracts html script and stylesheet links', function () {
    $root = sys_get_temp_dir().'/lss-graph-'.uniqid('', true);
    mkdir($root, 0777, true);
    file_put_contents($root.'/index.html', '<html><head><link href="deeltitel.css" rel="stylesheet"></head>'
        .'<body><script src="finwaardes.js"></script></body></html>');

    $edges = (new DependencyGraphBuilder(IgnoreRules::fromConfig()))->build($root);

    expect($edges)->toHaveCount(2)
        ->and(collect($edges)->pluck('to')->all())->toContain('deeltitel.css', 'finwaardes.js');

    array_map('unlink', glob($root.'/*') ?: []);
    rmdir($root);
});
