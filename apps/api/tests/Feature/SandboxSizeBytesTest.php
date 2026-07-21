<?php

use App\Models\Project;
use Illuminate\Testing\Fluent\AssertableJson;

/**
 * IG-24: sandboxSizeBytes serializer field.
 *
 * NOTE: These tests are written but not run in the sandbox environment
 * (PHP is unavailable in the CI sandbox). Run via `php artisan test` on
 * the host machine.
 */
describe('sandboxSizeBytes serializer (IG-24)', function () {
    beforeEach(function () {
        asUser();
    });

    it('returns null for a local-linked project', function () {
        $project = Project::factory()->create([
            'name' => 'local-linked',
            'source_type' => 'local',
            'local_source_path' => '/home/user/my-app',
            'sandbox_path' => null,
        ]);

        $this->getJson("/api/v1/projects/{$project->id}")
            ->assertOk()
            ->assertJson(fn (AssertableJson $json) => $json
                ->where('data.sourceType', 'local')
                ->where('data.sandboxSizeBytes', null)
                ->etc()
            );
    });

    it('returns 0 for an imported project with no sandbox directory yet', function () {
        $project = Project::factory()->create([
            'name' => 'fresh-import',
            'source_type' => 'import',
            'sandbox_path' => null,
        ]);

        $this->getJson("/api/v1/projects/{$project->id}")
            ->assertOk()
            ->assertJson(fn (AssertableJson $json) => $json
                ->where('data.sourceType', 'import')
                ->where('data.sandboxSizeBytes', 0)
                ->etc()
            );
    });

    it('serializer includes sandboxSizeBytes key in index response', function () {
        Project::factory()->create(['name' => 'index-check', 'source_type' => 'import']);

        $this->getJson('/api/v1/projects')
            ->assertOk()
            ->assertJson(fn (AssertableJson $json) => $json
                ->has('data.0', fn (AssertableJson $item) => $item
                    ->has('sandboxSizeBytes')
                    ->etc()
                )
                ->etc()
            );
    });
});
