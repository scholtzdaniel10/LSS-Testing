<?php

use App\Models\DiagnosticError;
use App\Models\GraphSnapshot;
use App\Models\JobStatus;
use App\Models\Project;
use App\Models\ProjectFile;
use App\Models\Scan;
use App\Models\UsageReport;
use App\Services\HealthSnapshotBuilder;

/**
 * HD-2 golden test: the builder aggregates a factory-built scan/usage/graph into
 * the expected C2 values. The fixture shape mirrors what DemoProjectSeeder used,
 * but is seeded via factories so it is self-contained and independent of the
 * global DatabaseSeeder.
 *
 * Derived expectations:
 *   filesAnalysed = 5 (5 ProjectFile rows)
 *   errorCounts   = {error: 2, warning: 0, info: 0}
 *   missingDeps   = 1 (guzzlehttp/guzzle)
 *   undeclaredEnvVars = 1 (MAIL_WEBHOOK_SECRET)
 *   errorScore    = 0  (2 errors / 5 files → 100% density → floor 0)
 *   dependencyScore = 77  (100 − 15×1 − 8×1)
 *   testScore     = 0  (no tests yet)
 *   structureScore = 100 (no hotspot above threshold in 5-file fixture)
 *   overall       = 39  (weighted blend per config/health.php)
 */
function buildSnapshotFixture(): Project
{
    $project = Project::factory()->create(['name' => 'snapshot-fixture']);

    foreach ([
        ['path' => 'app/Services/PaymentService.php', 'size' => 4200, 'lang' => 'php'],
        ['path' => 'app/Models/Invoice.php', 'size' => 1800, 'lang' => 'php'],
        ['path' => 'routes/web.php', 'size' => 2400, 'lang' => 'php'],
        ['path' => 'composer.json', 'size' => 900, 'lang' => 'json'],
        ['path' => 'resources/js/InvoiceForm.vue', 'size' => 3100, 'lang' => 'vue'],
    ] as $file) {
        ProjectFile::query()->create(array_merge(['project_id' => $project->id], $file));
    }

    UsageReport::factory()->create([
        'project_id' => $project->id,
        'report' => [
            'uses' => [
                'languages' => ['php', 'javascript'],
                'frameworks' => ['laravel', 'vue'],
                'deps' => [
                    ['name' => 'laravel/framework', 'version' => '^11.0', 'source' => 'composer'],
                ],
            ],
            'needs' => [
                'missingDeps' => ['guzzlehttp/guzzle'],
                'envVars' => ['MAIL_WEBHOOK_SECRET'],
                'services' => ['postgres', 'mail'],
            ],
        ],
    ]);

    GraphSnapshot::factory()->create([
        'project_id' => $project->id,
        'scanned_at' => now(),
        'edges' => [
            ['from' => 'app/Http/Controllers/InvoiceController.php', 'to' => 'app/Models/Invoice.php', 'kind' => 'import', 'line' => 8],
            ['from' => 'app/Http/Controllers/InvoiceController.php', 'to' => 'app/Services/PaymentService.php', 'kind' => 'import', 'line' => 9],
            ['from' => 'app/Services/PaymentService.php', 'to' => 'app/Models/Invoice.php', 'kind' => 'import', 'line' => 6],
            ['from' => 'routes/web.php', 'to' => 'app/Http/Controllers/StatementController.php', 'kind' => 'route', 'line' => 61],
            ['from' => 'app/Services/PaymentService.php', 'to' => 'pkg:guzzlehttp/guzzle', 'kind' => 'import', 'line' => 4],
        ],
    ]);

    $scan = Scan::factory()->create(['project_id' => $project->id, 'status' => 'done']);

    DiagnosticError::factory()->create([
        'scan_id' => $scan->id,
        'source' => 'phpstan',
        'rule_id' => 'nullsafe.neverNull',
        'kind' => 'null-risk',
        'severity' => 'error',
        'file' => 'app/Services/PaymentService.php',
        'range' => ['startLine' => 48, 'startCol' => 5, 'endLine' => 50, 'endCol' => 6],
        'message' => 'Cannot call method on nullable type Invoice|null.',
        'upstream' => ['app/Models/Invoice.php'],
        'downstream' => ['app/Http/Controllers/InvoiceController.php'],
    ]);

    DiagnosticError::factory()->create([
        'scan_id' => $scan->id,
        'source' => 'phpstan',
        'rule_id' => 'class.notFound',
        'kind' => 'contract-mismatch',
        'severity' => 'error',
        'file' => 'routes/web.php',
        'range' => ['startLine' => 61, 'startCol' => 1, 'endLine' => 61, 'endCol' => 80],
        'message' => 'Call to undefined method StatementController::export().',
        'upstream' => ['app/Http/Controllers/StatementController.php'],
        'downstream' => ['resources/js/StatementTable.vue'],
    ]);

    return $project;
}

describe('Health snapshot builder', function () {
    it('computes the C2 snapshot from real database state', function () {
        $project = buildSnapshotFixture();

        $snapshot = app(HealthSnapshotBuilder::class)->build($project);

        expect($snapshot['projectId'])->toBe($project->id)
            ->and($snapshot['metrics']['filesAnalysed'])->toBe(5)
            ->and($snapshot['metrics']['errorCounts'])->toBe(['error' => 2, 'warning' => 0, 'info' => 0])
            ->and($snapshot['metrics']['missingDeps'])->toBe(1)
            ->and($snapshot['metrics']['undeclaredEnvVars'])->toBe(1)
            ->and($snapshot['metrics']['testsTotal'])->toBe(0)
            // 5-file fixture: density formula clamps errors to 0 — honest, not a bug.
            ->and($snapshot['scores']['errors'])->toBe(0)
            ->and($snapshot['scores']['dependencies'])->toBe(77)   // 100 - 15*1 - 8*1
            ->and($snapshot['scores']['tests'])->toBe(0)           // no tests exist yet
            ->and($snapshot['scores']['structure'])->toBe(100)     // no hotspot clears the bar
            ->and($snapshot['scores']['overall'])->toBe(39);       // weighted blend

        expect($snapshot['topIssues'])->toHaveCount(3)
            ->and(collect($snapshot['topIssues'])->pluck('dimension')->all())
            ->toBe(['errors', 'errors', 'dependencies']);
    });

    it('runs as a queued job through the PLT-7 status pattern', function () {
        $project = buildSnapshotFixture();
        asUser();

        $response = $this->postJson("/api/v1/projects/{$project->id}/snapshot")
            ->assertStatus(202);

        $jobId = $response->json('data.jobId');

        // QUEUE_CONNECTION=sync in tests: the job already ran.
        $this->getJson("/api/v1/jobs/{$jobId}")
            ->assertOk()
            ->assertJsonPath('data.status', JobStatus::STATUS_DONE)
            ->assertJsonPath('data.progress', 100);

        // The freshly built snapshot is now the latest health report.
        $this->getJson("/api/v1/projects/{$project->id}/health-report")
            ->assertOk()
            ->assertJsonPath('data.scores.overall', 39)
            ->assertJsonPath('data.metrics.filesAnalysed', 5);
    });
});
