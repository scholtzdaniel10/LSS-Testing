<?php

use App\Services\Diagnostics\AnalysisRunner;
use App\Services\Diagnostics\AnalyzerRegistry;
use App\Services\Diagnostics\EvidenceGate;
use App\Services\Diagnostics\PhpcsAdapter;
use App\Services\Diagnostics\PhpmdAdapter;
use App\Services\Diagnostics\PhpStanAdapter;
use App\Services\Diagnostics\PhpTestFrameworkAdapter;

// ── DX-26 PhpTestFrameworkAdapter ─────────────────────────────────────────────

it('detects missing Pest/PHPUnit markers on PHP projects (DX-26)', function () {
    $fixture = base_path('tests/fixtures/php-test');
    $adapter = new PhpTestFrameworkAdapter;

    expect($adapter->detectFramework($fixture))->toBe('none');

    $findings = $adapter->run($fixture);
    expect($findings)->not->toBeEmpty()
        ->and($findings[0]['source'])->toBe('php-test')
        ->and($findings[0]['ruleId'])->toBe('no-framework')
        ->and($adapter->runStatus())->toBe('ok');
});

it('reports missing test files for concrete classes (DX-26)', function () {
    $fixture = base_path('tests/fixtures/php-test-with-pest');
    $adapter = new PhpTestFrameworkAdapter;

    expect($adapter->detectFramework($fixture))->toBe('pest');

    $findings = $adapter->run($fixture);
    expect($findings)->toHaveCount(0)
        ->and($adapter->runStatus())->toBe('clean');
});

it('flags classes without matching test files when framework is present (DX-26)', function () {
    $fixture = base_path('tests/fixtures/php-test-with-pest');
    file_put_contents($fixture.'/app/InvoiceService.php', <<<'PHP'
<?php

namespace App\Services;

class InvoiceService
{
}
PHP);

    try {
        $adapter = new PhpTestFrameworkAdapter;
        $findings = $adapter->run($fixture);

        expect($findings)->toHaveCount(1)
            ->and($findings[0]['ruleId'])->toBe('missing-test')
            ->and($findings[0]['file'])->toBe('app/InvoiceService.php')
            ->and($findings[0]['range']['startLine'])->toBeGreaterThan(0);
    } finally {
        @unlink($fixture.'/app/InvoiceService.php');
    }
});

// ── DX-27 PhpcsAdapter ────────────────────────────────────────────────────────

it('normalises PHPCS JSON output to C5 findings (DX-27)', function () {
    $json = json_encode([
        'files' => [
            '/sandbox/app/Bad.php' => [
                'messages' => [
                    [
                        'line' => 3,
                        'column' => 1,
                        'type' => 'ERROR',
                        'source' => 'PSR12.Files.FileHeader.SpacingAfterBlock',
                        'message' => 'Header blocks must be separated by a single blank line',
                    ],
                ],
            ],
        ],
    ], JSON_THROW_ON_ERROR);

    $adapter = PhpcsAdapter::withJsonRunner(fn () => $json);
    $findings = $adapter->run('/sandbox');

    expect($findings)->toHaveCount(1)
        ->and($findings[0]['source'])->toBe('phpcs')
        ->and($findings[0]['ruleId'])->toBe('PSR12.Files.FileHeader.SpacingAfterBlock')
        ->and($findings[0]['file'])->toBe('app/Bad.php')
        ->and($adapter->runStatus())->toBe('ok');
});

it('reports missing_binary when Maintain API has no PHPCS (DX-27)', function () {
    $adapter = new PhpcsAdapter(binary: '/nonexistent/phpcs-binary');
    $findings = $adapter->run('/sandbox');

    expect($findings)->toBe([])
        ->and($adapter->runStatus())->toBe('missing_binary');
});

// ── DX-30 PhpmdAdapter ────────────────────────────────────────────────────────

it('normalises PHPMD JSON output to C5 findings (DX-30)', function () {
    $json = json_encode([
        'files' => [
            [
                'file' => '/sandbox/application/models/User.php',
                'relativePath' => 'application/models/User.php',
                'violations' => [
                    [
                        'beginLine' => 12,
                        'endLine' => 12,
                        'rule' => 'UnusedPrivateField',
                        'ruleSet' => 'UnusedCode',
                        'description' => 'Avoid unused private fields such as \'$id\'.',
                        'priority' => 3,
                    ],
                ],
            ],
        ],
    ], JSON_THROW_ON_ERROR);

    $adapter = PhpmdAdapter::withJsonRunner(fn () => $json);
    $findings = $adapter->run('/sandbox');

    expect($findings)->toHaveCount(1)
        ->and($findings[0]['source'])->toBe('phpmd')
        ->and($findings[0]['ruleId'])->toBe('UnusedCode.UnusedPrivateField')
        ->and($findings[0]['file'])->toBe('application/models/User.php')
        ->and($findings[0]['severity'])->toBe('warning')
        ->and($adapter->runStatus())->toBe('ok');
});

it('reports missing_binary when Maintain API has no PHPMD (DX-30)', function () {
    $adapter = new PhpmdAdapter(binary: '/nonexistent/phpmd-binary');
    $findings = $adapter->run('/sandbox');

    expect($findings)->toBe([])
        ->and($adapter->runStatus())->toBe('missing_binary');
});

// ── Registry integration ──────────────────────────────────────────────────────

it('accepts php-test, phpcs, and phpmd findings through EvidenceGate (DX-26/27/30)', function () {
    $registry = new AnalyzerRegistry([
        new PhpStanAdapter,
        new PhpTestFrameworkAdapter,
        new PhpcsAdapter,
        new PhpmdAdapter,
    ]);
    $gate = new EvidenceGate($registry);

    $phpTest = $gate->accept([
        'source' => 'php-test',
        'ruleId' => 'missing-test',
        'kind' => 'contract-mismatch',
        'severity' => 'warning',
        'file' => 'app/Foo.php',
        'range' => ['startLine' => 5, 'startCol' => 0, 'endLine' => 5, 'endCol' => 0],
        'message' => 'No test file found for class Foo.',
    ]);

    $phpcs = $gate->accept([
        'source' => 'phpcs',
        'ruleId' => 'Generic.Files.LineLength.TooLong',
        'kind' => 'other',
        'severity' => 'warning',
        'file' => 'app/Foo.php',
        'range' => ['startLine' => 10, 'startCol' => 0, 'endLine' => 10, 'endCol' => 0],
        'message' => 'Line exceeds 120 characters.',
    ]);

    $phpmd = $gate->accept([
        'source' => 'phpmd',
        'ruleId' => 'UnusedCode.UnusedPrivateField',
        'kind' => 'unused',
        'severity' => 'warning',
        'file' => 'application/Foo.php',
        'range' => ['startLine' => 4, 'startCol' => 0, 'endLine' => 4, 'endCol' => 0],
        'message' => 'Avoid unused private fields.',
    ]);

    expect($phpTest['source'])->toBe('php-test')
        ->and($phpcs['source'])->toBe('phpcs')
        ->and($phpmd['source'])->toBe('phpmd');
});

it('registers new adapters in AnalysisRunner defaults (DX-26/27/30)', function () {
    config([
        'diagnostics.phpstan' => false,
        'diagnostics.js' => false,
        'diagnostics.php_test' => true,
        'diagnostics.phpcs' => true,
        'diagnostics.phpmd' => true,
    ]);

    $ids = array_map(
        fn ($adapter) => $adapter->source(),
        AnalysisRunner::defaultAdapters(),
    );

    expect($ids)->toBe(['php-test', 'phpcs', 'phpmd']);
});
