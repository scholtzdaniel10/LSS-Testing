<?php

use App\Models\Project;
use Illuminate\Testing\Fluent\AssertableJson;

describe('Errors API (Diagnose screen)', function () {
    beforeEach(function () {
        $this->seed();
        asUser();
        $this->project = Project::query()->firstOrFail();
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
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.kind', 'contract-mismatch');
    });

    it('rejects an invalid severity with a 422 field-path violation (PLT-6)', function () {
        $this->getJson("/api/v1/projects/{$this->project->id}/errors?severity=catastrophic")
            ->assertStatus(422)
            ->assertJsonPath('errors.0.violations.0.field', 'severity');
    });
});

describe('Graph & usage-report API (Explore screen)', function () {
    beforeEach(function () {
        $this->seed();
        asUser();
        $this->project = Project::query()->firstOrFail();
    });

    it('returns the latest graph snapshot edges', function () {
        $this->getJson("/api/v1/projects/{$this->project->id}/graph")
            ->assertOk()
            ->assertJsonCount(5, 'data.edges')
            ->assertJsonPath('data.edges.0.kind', 'import');
    });

    it('returns the usage report', function () {
        $this->getJson("/api/v1/projects/{$this->project->id}/usage-report")
            ->assertOk()
            ->assertJsonPath('data.report.needs.missingDeps.0', 'guzzlehttp/guzzle');
    });
});
