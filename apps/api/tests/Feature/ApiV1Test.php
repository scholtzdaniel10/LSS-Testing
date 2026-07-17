<?php

use App\Models\Project;
use Database\Seeders\DemoProjectSeeder;
use Illuminate\Testing\Fluent\AssertableJson;

describe('API envelope (contract C7)', function () {
    it('returns the envelope on success responses', function () {
        $this->getJson('/api/v1/health')
            ->assertOk()
            ->assertJson(fn (AssertableJson $json) => $json
                ->hasAll(['data', 'meta', 'errors'])
                ->where('meta.version', 'v1')
                ->where('errors', [])
            );
    });

    it('returns RFC-7807-style errors for missing resources', function () {
        $missingId = '00000000-0000-4000-8000-000000000000';

        $this->getJson("/api/v1/projects/{$missingId}")
            ->assertNotFound()
            ->assertJson(fn (AssertableJson $json) => $json
                ->hasAll(['data', 'meta', 'errors'])
                ->where('data', null)
                ->has('errors', 1)
                ->has('errors.0', fn (AssertableJson $error) => $error
                    ->where('title', 'Not found')
                    ->where('status', 404)
                    ->has('detail')
                    ->etc()
                )
            );
    });

    it('paginates list endpoints with meta.total', function () {
        $this->seed();

        $this->getJson('/api/v1/projects?per_page=1')
            ->assertOk()
            ->assertJson(fn (AssertableJson $json) => $json
                ->hasAll(['data', 'meta', 'errors'])
                ->has('data', 1)
                ->where('meta.total', 1)
                ->where('meta.per_page', 1)
                ->where('meta.page', 1)
                ->where('errors', [])
            );
    });
});

describe('Projects API', function () {
    beforeEach(function () {
        $this->seed();
    });

    it('lists seeded demo projects', function () {
        $this->getJson('/api/v1/projects')
            ->assertOk()
            ->assertJsonPath('data.0.id', DemoProjectSeeder::DEMO_PROJECT_ID)
            ->assertJsonPath('data.0.name', 'lexpro-portal');
    });

    it('returns a single project', function () {
        $project = Project::query()->firstOrFail();

        $this->getJson("/api/v1/projects/{$project->id}")
            ->assertOk()
            ->assertJsonPath('data.name', 'lexpro-portal')
            ->assertJsonPath('data.sandboxPath', 'sandboxes/lexpro-portal');
    });
});

describe('Health report API', function () {
    beforeEach(function () {
        $this->seed();
    });

    it('returns the latest C2 health snapshot', function () {
        $project = Project::query()->firstOrFail();

        $this->getJson("/api/v1/projects/{$project->id}/health-report")
            ->assertOk()
            ->assertJsonPath('data.projectId', $project->id)
            ->assertJsonPath('data.scores.overall', 63)
            ->assertJsonPath('data.metrics.filesAnalysed', 1842);
    });

    it('returns health snapshot history', function () {
        $project = Project::query()->firstOrFail();

        $this->getJson("/api/v1/projects/{$project->id}/health-report/history")
            ->assertOk()
            ->assertJsonPath('meta.total', 1)
            ->assertJsonPath('data.0.scores.overall', 63);
    });
});
