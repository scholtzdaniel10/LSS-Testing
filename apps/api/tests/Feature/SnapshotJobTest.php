<?php

use App\Models\JobStatus;
use App\Models\Project;
use App\Services\HealthSnapshotBuilder;

// HD-2 golden test: the builder aggregates the seeded scan/usage/graph into
// exactly these C2 values (derived by hand from DemoProjectSeeder + config/health).
describe('Health snapshot builder', function () {
    beforeEach(function () {
        $this->seed();
    });

    it('computes the C2 snapshot from real database state', function () {
        $project = Project::query()->firstOrFail();

        $snapshot = app(HealthSnapshotBuilder::class)->build($project);

        expect($snapshot['projectId'])->toBe($project->id)
            ->and($snapshot['metrics']['filesAnalysed'])->toBe(5)
            ->and($snapshot['metrics']['errorCounts'])->toBe(['error' => 2, 'warning' => 0, 'info' => 0])
            ->and($snapshot['metrics']['missingDeps'])->toBe(1)
            ->and($snapshot['metrics']['undeclaredEnvVars'])->toBe(1)
            ->and($snapshot['metrics']['testsTotal'])->toBe(0)
            // 5-file demo: density formula clamps errors to 0 — honest, not a bug.
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
        $project = Project::query()->firstOrFail();
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
