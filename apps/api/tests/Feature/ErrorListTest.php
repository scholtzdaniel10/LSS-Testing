<?php

use App\Models\DiagnosticError;
use App\Models\GraphSnapshot;
use App\Models\Project;
use App\Models\Scan;
use App\Models\UsageReport;
use Illuminate\Testing\Fluent\AssertableJson;

describe('Errors API (Diagnose screen)', function () {
    beforeEach(function () {
        asUser();
        $this->project = Project::factory()->create(['name' => 'errors-fixture']);
        $scan = Scan::factory()->create(['project_id' => $this->project->id, 'status' => 'done']);
        DiagnosticError::factory()->create([
            'scan_id' => $scan->id,
            'rule_id' => 'nullsafe.neverNull',
            'kind' => 'null-risk',
            'severity' => 'error',
            'file' => 'app/Services/PaymentService.php',
            'range' => ['startLine' => 48, 'startCol' => 5, 'endLine' => 50, 'endCol' => 6],
            'message' => 'Cannot call method on nullable type.',
            'upstream' => [],
            'downstream' => [],
        ]);
        DiagnosticError::factory()->create([
            'scan_id' => $scan->id,
            'rule_id' => 'class.notFound',
            'kind' => 'contract-mismatch',
            'severity' => 'error',
            'file' => 'routes/web.php',
            'range' => ['startLine' => 61, 'startCol' => 1, 'endLine' => 61, 'endCol' => 80],
            'message' => 'Call to undefined method.',
            'upstream' => [],
            'downstream' => [],
        ]);
    });

    it('lists latest-scan findings with keyset pagination meta', function () {
        $this->getJson("/api/v1/projects/{$this->project->id}/errors")
            ->assertOk()
            ->assertJson(fn (AssertableJson $json) => $json
                ->has('data', 2)
                ->has('meta.scanId')
                ->has('meta.per_page')
                ->etc()
            )
            ->assertJsonPath('data.0.ruleId', 'nullsafe.neverNull')
            ->assertJsonPath('data.0.severity', 'error');
    });

    it('filters by file', function () {
        $this->getJson("/api/v1/projects/{$this->project->id}/errors?file=routes/web.php")
           