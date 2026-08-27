<?php

use App\Models\DiagnosticError;
use App\Models\GraphSnapshot;
use App\Models\Project;
use App\Models\Scan;
use App\Models\TargetEnvironment;
use App\Models\UsageReport;
use App\Support\Contracts\ContractSchema;

describe('PLT-9: live API payloads match frozen contract schemas', function () {
    beforeEach(function () {
        asUser();
        $this->project = Project::factory()->create(['name' => 'contract-payload']);
    });

    it('serializes target environments as C1', function () {
        TargetEnvironment::query()->create([
            'project_id' => $this->project->id,
            'name' => 'local',
            'base_url' => 'http://127.0.0.1:8080',
            'notes' => null,
        ]);

        $row = $this->getJson("/api/v1/projects/{$this->project->id}/target-environments")
            ->assertOk()
            ->json('data.0');

        expect($row)->not->toHaveKey('notes');
        ContractSchema::validate(ContractSchema::C1, $row);
    });

    it('serializes health snapshots as C2', function () {
        $this->project->healthSnapshots()->create([
            'taken_at' => now(),
            'snapshot' => [
                'projectId' => $this->project->id,
                'takenAt' => now()->toIso8601String(),
                'scores' => ['overall' => 50, 'errors' => 50, 'dependencies' => 50, 'tests' => 0, 'structure' => 100],
                'metrics' => [
                    'errorCounts' => ['error' => 0, 'warning' => 0, 'info' => 0],
                    'errorChains' => 0,
                    'missingDeps' => 0,
                    'outdatedDeps' => 0,
                    'undeclaredEnvVars' => 0,
                    'testPassRate' => 0,
                    'testsTotal' => 0,
                    'filesAnalysed' => 1,
                    'hotspots' => [],
                ],
                'topIssues' => [],
            ],
        ]);

        $doc = $this->getJson("/api/v1/projects/{$this->project->id}/health-report")
            ->assertOk()
            ->json('data');

        ContractSchema::validate(ContractSchema::C2, $doc);
    });

    it('serializes graph edges as C3 (null line omitted)', function () {
        GraphSnapshot::factory()->create([
            'project_id' => $this->project->id,
            'edges' => [
                ['from' => 'index.html', 'to' => 'app.js', 'kind' => 'include', 'line' => null],
                ['from' => 'app.js', 'to' => 'pkg:react', 'kind' => 'import', 'line' => 1],
            ],
        ]);

        $edges = $this->getJson("/api/v1/projects/{$this->project->id}/graph")
            ->assertOk()
            ->json('data.edges');

        expect($edges[0])->not->toHaveKey('line');
        foreach ($edges as $edge) {
            ContractSchema::validate(ContractSchema::C3, $edge);
        }
    });

    it('serializes usage reports as C4', function () {
        UsageReport::factory()->create([
            'project_id' => $this->project->id,
            'report' => [
                'uses' => ['languages' => ['php'], 'frameworks' => [], 'deps' => []],
                'needs' => ['missingDeps' => [], 'envVars' => [], 'services' => []],
            ],
        ]);

        $report = $this->getJson("/api/v1/projects/{$this->project->id}/usage-report")
            ->assertOk()
            ->json('data.report');

        ContractSchema::validate(ContractSchema::C4, $report);
    });

    it('serializes diagnostic errors as C5 (null explanation omitted)', function () {
        $scan = Scan::factory()->create(['project_id' => $this->project->id, 'status' => 'done']);
        DiagnosticError::factory()->create([
            'scan_id' => $scan->id,
            'explanation' => null,
        ]);

        $row = $this->getJson("/api/v1/projects/{$this->project->id}/errors")
            ->assertOk()
            ->json('data.0');

        expect($row)->not->toHaveKey('explanation');
        ContractSchema::validate(ContractSchema::C5, $row);
    });
});
