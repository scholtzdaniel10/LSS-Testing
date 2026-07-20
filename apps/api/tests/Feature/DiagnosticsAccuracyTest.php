<?php

use App\Services\Diagnostics\EvidenceGate;
use App\Services\Diagnostics\PhpStanAdapter;
use App\Support\Sandbox\IgnoreRules;
use App\Support\Sandbox\PathJail;

it('rejects findings without analyser evidence (DX-15)', function () {
    $gate = new EvidenceGate;

    expect(fn () => $gate->accept([
        'source' => 'phpstan',
        'ruleId' => '',
        'file' => 'a.php',
        'range' => ['startLine' => 1, 'startCol' => 0, 'endLine' => 1, 'endCol' => 0],
        'message' => 'x',
    ]))->toThrow(InvalidArgumentException::class);

    expect(fn () => $gate->accept([
        'source' => 'phpstan',
        'ruleId' => 'x',
        'file' => '',
        'range' => ['startLine' => 1, 'startCol' => 0, 'endLine' => 1, 'endCol' => 0],
        'message' => 'x',
    ]))->toThrow(InvalidArgumentException::class);

    expect(fn () => $gate->accept([
        'source' => 'phpstan',
        'ruleId' => 'x',
        'file' => 'a.php',
        'range' => ['startLine' => 0, 'startCol' => 0, 'endLine' => 1, 'endCol' => 0],
        'message' => 'x',
    ]))->toThrow(InvalidArgumentException::class);

    $ok = $gate->accept([
        'source' => 'phpstan',
        'ruleId' => 'argument.type',
        'kind' => 'type-error',
        'severity' => 'error',
        'file' => 'a.php',
        'range' => ['startLine' => 4, 'startCol' => 0, 'endLine' => 4, 'endCol' => 10],
        'message' => 'expects int',
    ]);

    expect($ok['ruleId'])->toBe('argument.type')
        ->and($ok['file'])->toBe('a.php');
});

it('normalises PHPStan JSON to C5 findings (DX-2)', function () {
    $json = json_encode([
        'files' => [
            '/sandbox/src/Defects.php' => [
                'messages' => [
                    [
                        'message' => 'Cannot access property',
                        'line' => 11,
                        'identifier' => 'property.nonObject',
                    ],
                    [
                        'message' => 'Function not found',
                        'line' => 22,
                        'identifier' => 'function.notFound',
                    ],
                    [
                        'message' => 'Argument type',
                        'line' => 30,
                        'identifier' => 'argument.type',
                    ],
                    [
                        'message' => 'Return type',
                        'line' => 16,
                        'identifier' => 'return.type',
                    ],
                    [
                        'message' => 'Class not found',
                        'line' => 40,
                        'identifier' => 'class.notFound',
                    ],
                ],
            ],
        ],
    ], JSON_THROW_ON_ERROR);

    $adapter = PhpStanAdapter::withJsonRunner(fn () => $json);
    $findings = $adapter->run('/sandbox');

    expect($findings)->toHaveCount(5)
        ->and($findings[0]['source'])->toBe('phpstan')
        ->and($findings[0]['ruleId'])->toBe('property.nonObject')
        ->and($findings[0]['range']['startLine'])->toBe(11)
        ->and($findings[0]['file'])->toBe('src/Defects.php');
});

it('writes CI3 PHPStan bootstrap without composer (DX-16)', function () {
    $fixture = base_path('tests/fixtures/ci3-mini');
    $adapter = new PhpStanAdapter;
    $config = $adapter->ensureConfig($fixture);

    expect($config)->toEndWith('.lss-phpstan.neon')
        ->and(file_get_contents($config))->toContain('scanDirectories')
        ->and(file_get_contents($config))->toContain('application');

    @unlink($config);
});

it('path-jails traversal attempts (PLT-8)', function () {
    $root = sys_get_temp_dir().DIRECTORY_SEPARATOR.'lss-jail-'.uniqid();
    mkdir($root);
    $jail = new PathJail($root);
    $id = 'a1b2c3d4-e5f6-4789-a012-3456789abcde';
    mkdir($jail->projectRoot($id), 0755, true);

    expect(fn () => $jail->resolve($id, '../outside.txt'))
        ->toThrow(InvalidArgumentException::class);

    $ignore = new IgnoreRules(['node_modules', 'vendor']);
    expect($ignore->shouldSkip('app/node_modules/x.js'))->toBeTrue()
        ->and($ignore->shouldSkip('application/controllers/Welcome.php'))->toBeFalse();

    // cleanup
    rmdir($jail->projectRoot($id));
    rmdir($root);
});
