<?php

namespace Database\Seeders;

use App\Models\DiagnosticError;
use App\Models\GraphSnapshot;
use App\Models\HealthSnapshot;
use App\Models\Project;
use App\Models\ProjectFile;
use App\Models\Scan;
use App\Models\TargetEnvironment;
use App\Models\UsageReport;
use Illuminate\Database\Seeder;

/**
 * Seeds the v0-preview demo program (lexpro-portal) so the UI can swap off mock data.
 * Shapes follow contracts C2–C5 from packages/schemas.
 */
class DemoProjectSeeder extends Seeder
{
    public const DEMO_PROJECT_ID = 'a1b2c3d4-e5f6-4789-a012-3456789abcde';

    public function run(): void
    {
        $project = Project::query()->updateOrCreate(
            ['id' => self::DEMO_PROJECT_ID],
            [
                'name' => 'lexpro-portal',
                'sandbox_path' => 'sandboxes/lexpro-portal',
                'last_imported_at' => now()->parse('2026-07-16 14:20:00'),
            ],
        );

        $this->seedFiles($project);
        $this->seedUsageReport($project);
        $this->seedGraph($project);
        $scan = $this->seedScanAndErrors($project);
        unset($scan);
        $this->seedHealthSnapshots($project);
        $this->seedTargetEnvironment($project);
    }

    private function seedFiles(Project $project): void
    {
        $files = [
            ['path' => 'app/Services/PaymentService.php', 'size' => 4200, 'lang' => 'php'],
            ['path' => 'app/Models/Invoice.php', 'size' => 1800, 'lang' => 'php'],
            ['path' => 'routes/web.php', 'size' => 2400, 'lang' => 'php'],
            ['path' => 'composer.json', 'size' => 900, 'lang' => 'json'],
            ['path' => 'resources/js/InvoiceForm.vue', 'size' => 3100, 'lang' => 'vue'],
        ];

        foreach ($files as $file) {
            ProjectFile::query()->updateOrCreate(
                ['project_id' => $project->id, 'path' => $file['path']],
                ['size' => $file['size'], 'lang' => $file['lang']],
            );
        }
    }

    private function seedUsageReport(Project $project): void
    {
        UsageReport::query()->updateOrCreate(
            ['project_id' => $project->id],
            [
                'report' => [
                    'uses' => [
                        'languages' => ['php', 'javascript'],
                        'frameworks' => ['laravel', 'vue'],
                        'deps' => [
                            ['name' => 'laravel/framework', 'version' => '^11.0', 'source' => 'composer'],
                            ['name' => 'vue', 'version' => '^3.4', 'source' => 'npm'],
                        ],
                    ],
                    'needs' => [
                        'missingDeps' => ['guzzlehttp/guzzle'],
                        'envVars' => ['MAIL_WEBHOOK_SECRET'],
                        'services' => ['postgres', 'mail'],
                    ],
                ],
            ],
        );
    }

    private function seedGraph(Project $project): void
    {
        GraphSnapshot::query()->updateOrCreate(
            ['project_id' => $project->id],
            [
                'scanned_at' => now()->parse('2026-07-16 14:25:00'),
                'edges' => [
                    ['from' => 'app/Http/Controllers/InvoiceController.php', 'to' => 'app/Models/Invoice.php', 'kind' => 'import', 'line' => 8],
                    ['from' => 'app/Http/Controllers/InvoiceController.php', 'to' => 'app/Services/PaymentService.php', 'kind' => 'import', 'line' => 9],
                    ['from' => 'app/Services/PaymentService.php', 'to' => 'app/Models/Invoice.php', 'kind' => 'import', 'line' => 6],
                    ['from' => 'routes/web.php', 'to' => 'app/Http/Controllers/StatementController.php', 'kind' => 'route', 'line' => 61],
                    ['from' => 'app/Services/PaymentService.php', 'to' => 'pkg:guzzlehttp/guzzle', 'kind' => 'import', 'line' => 4],
                ],
            ],
        );
    }

    private function seedScanAndErrors(Project $project): Scan
    {
        $scan = Scan::query()->updateOrCreate(
            ['project_id' => $project->id, 'scan_hash' => 'demo-v0-preview'],
            ['status' => 'done'],
        );

        $errors = [
            [
                'id' => 'e1111111-1111-4111-8111-111111111111',
                'source' => 'phpstan',
                'rule_id' => 'nullsafe.neverNull',
                'kind' => 'null-risk',
                'severity' => 'error',
                'file' => 'app/Services/PaymentService.php',
                'range' => ['startLine' => 48, 'startCol' => 5, 'endLine' => 50, 'endCol' => 6],
                'message' => 'Cannot call method on nullable type Invoice|null.',
                'explanation' => 'Invoice::find() can return null, and capture() dereferences it without a guard.',
                'upstream' => ['app/Models/Invoice.php'],
                'downstream' => [
                    'app/Http/Controllers/InvoiceController.php',
                    'app/Http/Controllers/StatementController.php',
                ],
            ],
            [
                'id' => 'e2222222-2222-4222-8222-222222222222',
                'source' => 'phpstan',
                'rule_id' => 'class.notFound',
                'kind' => 'contract-mismatch',
                'severity' => 'error',
                'file' => 'routes/web.php',
                'range' => ['startLine' => 61, 'startCol' => 1, 'endLine' => 61, 'endCol' => 80],
                'message' => 'Call to undefined method StatementController::export().',
                'explanation' => 'The route still points at a removed controller method; every request 500s.',
                'upstream' => ['app/Http/Controllers/StatementController.php'],
                'downstream' => ['resources/js/StatementTable.vue'],
            ],
        ];

        foreach ($errors as $error) {
            DiagnosticError::query()->updateOrCreate(
                ['id' => $error['id']],
                array_merge($error, ['scan_id' => $scan->id]),
            );
        }

        return $scan;
    }

    private function seedHealthSnapshots(Project $project): void
    {
        $takenAt = now()->parse('2026-07-16 18:30:00');

        HealthSnapshot::query()->updateOrCreate(
            [
                'project_id' => $project->id,
                'taken_at' => $takenAt,
            ],
            [
                'snapshot' => [
                    'projectId' => $project->id,
                    'takenAt' => $takenAt->toIso8601String(),
                    'scores' => [
                        'overall' => 63,
                        'errors' => 55,
                        'dependencies' => 48,
                        'tests' => 71,
                        'structure' => 78,
                    ],
                    'metrics' => [
                        'errorCounts' => ['error' => 12, 'warning' => 31, 'info' => 4],
                        'errorChains' => 2,
                        'missingDeps' => 3,
                        'outdatedDeps' => 14,
                        'undeclaredEnvVars' => 2,
                        'testPassRate' => 0.81,
                        'testsTotal' => 21,
                        'filesAnalysed' => 1842,
                        'hotspots' => [
                            ['file' => 'app/Services/PaymentService.php', 'centrality' => 0.91, 'errorDensity' => 0.62],
                            ['file' => 'app/Models/Invoice.php', 'centrality' => 0.84, 'errorDensity' => 0.35],
                            ['file' => 'routes/web.php', 'centrality' => 0.77, 'errorDensity' => 0.31],
                        ],
                    ],
                    'topIssues' => [
                        [
                            'dimension' => 'errors',
                            'refType' => 'error',
                            'refId' => 'e1111111-1111-4111-8111-111111111111',
                            'summary' => 'Nullable invoice passed unchecked into PaymentService::capture()',
                        ],
                        [
                            'dimension' => 'dependencies',
                            'refType' => 'dep',
                            'refId' => 'guzzlehttp/guzzle',
                            'summary' => 'guzzlehttp/guzzle used but missing from composer.json',
                        ],
                        [
                            'dimension' => 'tests',
                            'refType' => 'testRun',
                            'refId' => 'create-invoice',
                            'summary' => 'Create invoice failing for 3 consecutive runs',
                        ],
                    ],
                ],
            ],
        );
    }

    private function seedTargetEnvironment(Project $project): void
    {
        TargetEnvironment::query()->updateOrCreate(
            ['project_id' => $project->id, 'name' => 'staging'],
            [
                'base_url' => 'https://staging.lexpro-portal.internal',
                'notes' => 'Reachable on office VPN only',
            ],
        );
    }
}
