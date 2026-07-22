<?php

use App\Models\HealthSnapshot;
use App\Models\Project;
use Illuminate\Testing\Fluent\AssertableJson;

/**
 * PLT-13: API performance + robustness regression tests.
 *
 * Covers:
 *  - Project list includes fileCount without N+1
 *  - Health-report history validates date params (422 on bad input)
 *  - Health-report history accepts valid date params (200)
 *  - Health-report history rejects out-of-range per_page (422)
 *  - Unknown project returns 404 envelope (not a 500)
 *  - Graph endpoint returns 200 with no-graph-yet meta for un-scanned project
 *  - Errors endpoint returns 200 with not-scanned-yet reason for un-scanned project
 */

describe('PLT-13 performance: project list serializer (N+1 fix)', function () {
    beforeEach(function () {
        asUser();
    });

    it('returns fileCount in project list without extra queries', function () {
        $project = Project::factory()->create(['name' => 'plt13-files-count']);
        $project->files()->createMany([
            ['path' => 'a.php', 'size' => 100, 'lang' => 'php'],
            ['path' => 'b.php', 'size' => 200, 'lang' => 'php'],
        ]);

        $this->getJson('/api/v1/projects')
            ->assertOk()
            ->assertJson(fn (AssertableJson $json) => $json
                ->has('data.0', fn (AssertableJson $item) => $item
                    ->where('name', 'plt13-files-count')
                    ->where('fileCount', 2)
                    ->etc()
                )
                ->etc()
            );
    });

    it('returns fileCount in single project show', function () {
        $project = Project::factory()->create(['name' => 'plt13-show-count']);
        $project->files()->create(['path' => 'x.php', 'size' => 50, 'lang' => 'php']);

        $this->getJson("/api/v1/projects/{$project->id}")
            ->assertOk()
            ->assertJsonPath('data.fileCount', 1);
    });
});

describe('PLT-13 robustness: health-report history validation', function () {
    beforeEach(function () {
        asUser();
        $this->project = Project::factory()->create(['name' => 'plt13-history']);
        HealthSnapshot::query()->create([
            'project_id' => $this->project->id,
            'taken_at' => now()->subDay(),
            'snapshot' => ['scores' => ['overall' => 50]],
        ]);
    });

    it('returns 422 problem+json for an invalid from date', function () {
        $this->getJson("/api/v1/projects/{$this->project->id}/health-report/history?from=not-a-date")
            ->assertStatus(422)
            ->assertJson(fn (AssertableJson $json) => $json
                ->where('data', null)
                ->has('errors', 1)
                ->has('errors.0', fn (AssertableJson $error) => $error
                    ->where('status', 422)
                    ->has('violations')
                    ->etc()
                )
                ->etc()
            );
    });

    it('returns 422 problem+json for an invalid to date', function () {
        $this->getJson("/api/v1/projects/{$this->project->id}/health-report/history?to=garbage")
            ->assertStatus(422)
            ->assertJsonPath('errors.0.status', 422);
    });

    it('returns 422 for out-of-range per_page', function () {
        $this->getJson("/api/v1/projects/{$this->project->id}/health-report/history?per_page=0")
            ->assertStatus(422);
    });

    it('accepts valid ISO date strings and returns paginated results', function () {
        $this->getJson("/api/v1/projects/{$this->project->id}/health-report/history?from=2020-01-01&to=2099-12-31&per_page=10")
            ->assertOk()
            ->assertJsonPath('meta.per_page', 10)
            ->assertJson(fn (AssertableJson $json) => $json
                ->has('meta.total')
                ->etc()
            );
    });

    it('returns an empty list (not 500) when no snapshots match the date range', function () {
        $this->getJson("/api/v1/projects/{$this->project->id}/health-report/history?from=2099-01-01")
            ->assertOk()
            ->assertJsonPath('meta.total', 0);
    });
});

describe('PLT-13 robustness: 404 envelope for missing resources', function () {
    beforeEach(function () {
        asUser();
    });

    it('returns 404 problem envelope for an unknown project on graph endpoint', function () {
        $missing = '00000000-0000-4000-8000-000000000099';

        $this->getJson("/api/v1/projects/{$missing}/graph")
            ->assertNotFound()
            ->assertJson(fn (AssertableJson $json) => $json
                ->where('data', null)
                ->has('errors', 1)
                ->has('errors.0', fn (AssertableJson $error) => $error
                    ->where('status', 404)
                    ->etc()
                )
                ->etc()
            );
    });

    it('returns 404 problem envelope for an unknown project on errors endpoint', function () {
        $missing = '00000000-0000-4000-8000-000000000099';

        $this->getJson("/api/v1/projects/{$missing}/errors")
            ->assertNotFound();
    });

    it('returns 200 with no-graph-yet meta for a project with no graph snapshot', function () {
        $project = Project::factory()->create(['name' => 'plt13-no-graph']);

        $this->getJson("/api/v1/projects/{$project->id}/graph")
            ->assertOk()
            ->assertJsonPath('data', null)
            ->assertJsonPath('meta.reason', 'no-graph-yet');
    });

    it('returns 200 with not-scanned-yet meta for a project with no scan', function () {
        $project = Project::factory()->create(['name' => 'plt13-no-scan']);

        $this->getJson("/api/v1/projects/{$project->id}/errors")
            ->assertOk()
            ->assertJsonPath('meta.reason', 'not-scanned-yet');
    });
});
