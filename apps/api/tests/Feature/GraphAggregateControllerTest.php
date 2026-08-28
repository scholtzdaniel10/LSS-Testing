<?php

use App\Models\DiagnosticError;
use App\Models\GraphSnapshot;
use App\Models\Project;
use App\Models\Scan;
use App\Support\Cache\ProjectReadCache;
use Illuminate\Support\Facades\Cache;
use Illuminate\Testing\Fluent\AssertableJson;

describe('Graph overview API', function () {
    beforeEach(function () {
        asUser();
        Cache::flush();
        $this->project = Project::factory()->create(['name' => 'overview-fixture']);
    });

    it('returns no-graph-yet with data null when no snapshot exists', function () {
        $this->getJson("/api/v1/projects/{$this->project->id}/graph/overview")
            ->assertOk()
            ->assertJsonPath('data', null)
            ->assertJsonPath('meta.reason', 'no-graph-yet')
            ->assertJsonPath('errors', []);
    });

    it('returns the C7 envelope with ranked nodes, links, and truncation meta', function () {
        $rows = [];
        for ($i = 0; $i < 100; $i++) {
            $rows[] = ['path' => "src/f{$i}.ts", 'size' => 1, 'lang' => 'typescript'];
        }
        $this->project->files()->createMany($rows);

        GraphSnapshot::factory()->create([
            'project_id' => $this->project->id,
            'edges' => [],
        ]);

        $scan = Scan::factory()->create(['project_id' => $this->project->id, 'status' => 'done']);
        DiagnosticError::factory()->create([
            'scan_id' => $scan->id,
            'file' => 'src/f0.ts',
        ]);

        $this->getJson("/api/v1/projects/{$this->project->id}/graph/overview?limit=20")
            ->assertOk()
            ->assertJson(fn (AssertableJson $json) => $json
                ->has('data.projectId')
                ->has('data.scannedAt')
                ->has('data.nodes')
                ->has('data.links')
                ->where('meta.cap', 20)
                ->where('meta.returned', 22)
                ->where('meta.total', 101)
                ->where('meta.truncated', true)
                ->where('errors', [])
                ->etc()
            )
            ->assertJsonMissingPath('data.edges')
            ->assertJsonMissingPath('data.files')
            ->assertJsonMissingPath('data.nodes.0.color')
            ->assertJsonMissingPath('meta.page')
            ->assertJsonMissingPath('meta.per_page');

        $ids = collect($this->getJson("/api/v1/projects/{$this->project->id}/graph/overview?limit=20")->json('data.nodes'))
            ->pluck('id')
            ->all();
        expect($ids)->toContain('src/f0.ts', 'dir:src');
    });

    it('clamps limit to the configured hard max and defaults to 40', function () {
        $this->project->files()->create(['path' => 'app/A.php', 'size' => 1, 'lang' => 'php']);
        GraphSnapshot::factory()->create([
            'project_id' => $this->project->id,
            'edges' => [],
        ]);

        $this->getJson("/api/v1/projects/{$this->project->id}/graph/overview")
            ->assertOk()
            ->assertJsonPath('meta.cap', 40);

        $this->getJson("/api/v1/projects/{$this->project->id}/graph/overview?limit=9999")
            ->assertOk()
            ->assertJsonPath('meta.cap', 200);

        $this->getJson("/api/v1/projects/{$this->project->id}/graph/overview?limit=0")
            ->assertOk()
            ->assertJsonPath('meta.cap', 1);
    });

    it('rejects a non-numeric limit with a 422 field-path violation', function () {
        GraphSnapshot::factory()->create([
            'project_id' => $this->project->id,
            'edges' => [],
        ]);

        $this->getJson("/api/v1/projects/{$this->project->id}/graph/overview?limit=abc")
            ->assertStatus(422)
            ->assertJsonPath('errors.0.violations.0.field', 'limit');
    });

    it('does not change GET /graph data shape', function () {
        $edges = [
            ['from' => 'app/A.php', 'to' => 'app/B.php', 'kind' => 'import', 'line' => 1],
        ];
        GraphSnapshot::factory()->create([
            'project_id' => $this->project->id,
            'edges' => $edges,
        ]);

        $body = $this->getJson("/api/v1/projects/{$this->project->id}/graph")
            ->assertOk()
            ->json('data');

        expect(array_keys($body))->toBe(['projectId', 'scannedAt', 'edges'])
            ->and($body['edges'][0])->toMatchArray([
                'from' => 'app/A.php',
                'to' => 'app/B.php',
                'kind' => 'import',
                'line' => 1,
            ]);
    });

    it('serves cached overview until forgetGraph clears the limit bucket', function () {
        $this->project->files()->create(['path' => 'app/A.php', 'size' => 1, 'lang' => 'php']);
        $this->project->files()->create(['path' => 'lib/B.php', 'size' => 1, 'lang' => 'php']);
        GraphSnapshot::factory()->create([
            'project_id' => $this->project->id,
            'scanned_at' => now()->subMinute(),
            'edges' => [
                ['from' => 'app/A.php', 'to' => 'lib/B.php', 'kind' => 'import', 'line' => 1],
            ],
        ]);

        $first = $this->getJson("/api/v1/projects/{$this->project->id}/graph/overview?limit=40")
            ->assertOk()
            ->json('data.links');
        expect($first)->toHaveCount(1);

        GraphSnapshot::factory()->create([
            'project_id' => $this->project->id,
            'scanned_at' => now(),
            'edges' => [],
        ]);

        $cached = $this->getJson("/api/v1/projects/{$this->project->id}/graph/overview?limit=40")
            ->assertOk()
            ->json('data.links');
        expect($cached)->toBe($first);

        ProjectReadCache::forgetGraph($this->project->id);

        $fresh = $this->getJson("/api/v1/projects/{$this->project->id}/graph/overview?limit=40")
            ->assertOk()
            ->json('data.links');
        expect($fresh)->toBe([]);
    });
});
