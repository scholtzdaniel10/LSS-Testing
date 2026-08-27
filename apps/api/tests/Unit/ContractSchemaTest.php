<?php

use App\Support\Contracts\ContractDocuments;
use App\Support\Contracts\ContractSchema;

function goldenC1(): array
{
    return [
        'id' => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'projectId' => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        'name' => 'staging',
        'baseUrl' => 'https://staging.example.test',
        'notes' => 'VPN required',
    ];
}

function goldenC2(): array
{
    return [
        'projectId' => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        'takenAt' => '2026-08-27T08:00:00+00:00',
        'scores' => [
            'overall' => 40,
            'errors' => 20,
            'dependencies' => 80,
            'tests' => 0,
            'structure' => 90,
        ],
        'metrics' => [
            'errorCounts' => ['error' => 2, 'warning' => 1, 'info' => 0],
            'errorChains' => 1,
            'missingDeps' => 1,
            'outdatedDeps' => 0,
            'undeclaredEnvVars' => 1,
            'testPassRate' => 0,
            'testsTotal' => 0,
            'filesAnalysed' => 10,
            'hotspots' => [
                ['file' => 'app/Services/PaymentService.php', 'centrality' => 0.8, 'errorDensity' => 0.4],
            ],
        ],
        'topIssues' => [
            [
                'dimension' => 'errors',
                'refType' => 'error',
                'refId' => 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
                'summary' => 'Cannot call method on nullable type.',
            ],
        ],
    ];
}

function goldenC3(): array
{
    return [
        'from' => 'app/Http/Controllers/InvoiceController.php',
        'to' => 'app/Models/Invoice.php',
        'kind' => 'import',
        'line' => 8,
    ];
}

function goldenC4(): array
{
    return [
        'uses' => [
            'languages' => ['php'],
            'frameworks' => ['laravel'],
            'deps' => [
                ['name' => 'laravel/framework', 'version' => '^11.0', 'source' => 'composer'],
            ],
        ],
        'needs' => [
            'missingDeps' => ['guzzlehttp/guzzle'],
            'envVars' => ['MAIL_WEBHOOK_SECRET'],
            'services' => ['postgres'],
        ],
    ];
}

function goldenC5(): array
{
    return [
        'id' => 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        'source' => 'phpstan',
        'ruleId' => 'nullsafe.neverNull',
        'kind' => 'null-risk',
        'severity' => 'error',
        'file' => 'app/Services/PaymentService.php',
        'range' => ['startLine' => 48, 'startCol' => 5, 'endLine' => 50, 'endCol' => 6],
        'message' => 'Cannot call method on nullable type.',
        'explanation' => 'A value may be null here.',
        'upstream' => ['app/Models/Invoice.php'],
        'downstream' => ['app/Http/Controllers/InvoiceController.php'],
    ];
}

function goldenC6(): array
{
    return [
        'id' => 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        'projectId' => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        'targetEnvId' => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'name' => 'Login page loads',
        'steps' => [
            [
                'id' => 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
                'action' => 'navigate',
                'target' => ['selector' => '[data-testid="login"]'],
            ],
        ],
    ];
}

it('loads C1–C6 from packages/schemas, never a local copy (PLT-9)', function () {
    $dir = ContractSchema::directory();

    expect($dir)->toEndWith(DIRECTORY_SEPARATOR.'packages'.DIRECTORY_SEPARATOR.'schemas')
        ->and(is_file(ContractSchema::path(ContractSchema::C1)))->toBeTrue()
        ->and(is_file(ContractSchema::path(ContractSchema::C6)))->toBeTrue();
});

it('accepts golden C1–C6 documents', function (string $contract, array $document) {
    expect(ContractSchema::isValid($contract, $document))->toBeTrue();
})->with([
    'C1' => [ContractSchema::C1, goldenC1()],
    'C2' => [ContractSchema::C2, goldenC2()],
    'C3' => [ContractSchema::C3, goldenC3()],
    'C4' => [ContractSchema::C4, goldenC4()],
    'C5' => [ContractSchema::C5, goldenC5()],
    'C6' => [ContractSchema::C6, goldenC6()],
]);

it('rejects extra properties (additionalProperties: false)', function () {
    $c3 = goldenC3();
    $c3['extra'] = 'nope';

    expect(fn () => ContractSchema::validate(ContractSchema::C3, $c3))
        ->toThrow(InvalidArgumentException::class);
});

it('rejects C3 edges that still emit JSON null for line', function () {
    expect(ContractSchema::isValid(ContractSchema::C3, [
        'from' => 'index.html',
        'to' => 'app.js',
        'kind' => 'include',
        'line' => null,
    ]))->toBeFalse();
});

it('omits unknown line so HTML edges match C3', function () {
    $normalized = ContractDocuments::edge([
        'from' => 'index.html',
        'to' => 'app.js',
        'kind' => 'include',
        'line' => null,
    ]);

    expect($normalized)->not->toHaveKey('line')
        ->and(ContractSchema::isValid(ContractSchema::C3, $normalized))->toBeTrue();
});

it('omits null notes so C1 serialize matches the schema', function () {
    $normalized = ContractDocuments::targetEnvironment([
        'id' => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'projectId' => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        'name' => 'local',
        'baseUrl' => 'http://127.0.0.1:8080',
        'notes' => null,
    ]);

    expect($normalized)->not->toHaveKey('notes')
        ->and(ContractSchema::isValid(ContractSchema::C1, $normalized))->toBeTrue();
});

it('omits null explanation so C5 serialize matches the schema', function () {
    $normalized = ContractDocuments::finding([
        'id' => 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        'source' => 'phpstan',
        'ruleId' => 'x',
        'kind' => 'other',
        'severity' => 'warning',
        'file' => 'app/A.php',
        'range' => ['startLine' => 1, 'startCol' => 0, 'endLine' => 1, 'endCol' => 1],
        'message' => 'n',
        'explanation' => null,
        'upstream' => [],
        'downstream' => [],
    ]);

    expect($normalized)->not->toHaveKey('explanation')
        ->and(ContractSchema::isValid(ContractSchema::C5, $normalized))->toBeTrue();
});
