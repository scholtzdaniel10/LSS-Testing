<?php

use App\Models\Project;
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
        asUser();
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
        asUser();
        Project::factory()->create(['name' => 'pagination-fixture']);

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
        asUser();
    });

    it('lists projects created at runtime', function () {
        Project::factory()->create(['name' => 'my-real-app']);

        $this->getJson('/api/v1/projects')
            ->assertOk()
            ->assertJsonPath('data.0.name', 'my-real-app');
    });

    it('returns a single project', function () {
        $project = Project::factory()->create(['name' => 'sample-app', 'sandbox_path' => 'sandboxes/sample-app']);

        $this->getJson("/api/v1/projects/{$project->id}")
            ->assertOk()
            ->assertJsonPath('data.name', 'sample-app')
            ->assertJsonPath('data.sandboxPath', 'sandboxes/sample-app');
    });

    it('deletes a project', function () {
        $project = Project::factory()->create(['name' => 'throwaway-import']);

        $this->deleteJson("/api/v1/projects/{$project->id}")
            ->assertOk()
            ->assertJsonPath('data.deleted', true);

        expect(Project::query()->find($project->id))->toBeNull();
    });
});

describe('Health report API', function () {
    beforeEach(function () {
        asUser();
    });

    it('returns null for a project with no snapshot', function () {
        $project = Project::factory()->create(['name' => 'unscan-app']);

        $this->getJson("/api/v1/projects/{$project->id}/health-report")
            ->assertOk()
            ->assertJsonPath('data', null);
    });

    it('returns an empty history for a project with no snapshots', function () {
        $project = Project::factory()->create(['name' => 'no-history-app']);

        $this->getJson("/api/v1/projects/{$project->id}/health-report/history")
            ->assertOk()
            ->assertJsonPath('meta.total', 0);
    });
});

describe('Fresh seed produces no projects (DX: dummy data removal)', function () {
    it('yields zero projects after migrate --seed', function () {
        // The global seeder no longer calls DemoProjectSeeder; a freshly seeded
        // DB must have no projects so real linked programs are not contaminated.
        $this->seed();
        asUser();

        $this->getJson('/api/v1/projects')
            ->assertOk()
            ->assertJsonPath('meta.total', 0);

        expect(Project::query()->count())->toBe(0);
    });
});
