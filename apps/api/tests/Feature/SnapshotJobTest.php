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
            ['from' 