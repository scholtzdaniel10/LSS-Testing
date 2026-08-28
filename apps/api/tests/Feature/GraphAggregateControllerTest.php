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

describe('Graph rollup API', function () {
    beforeEach(function () {
        asUser();
        Cache::flush();
        $this->project = Project::factory()->create(['name' => 'rollup-fixture']);
    });

    it('returns no-graph-yet with data null when no snapshot exists', function () {
        $this->getJson("/api/v1/projects/{$this->project->id}/graph/rollup")
            ->assertOk()
            ->assertJsonPath('data', null)
            ->assertJsonPath('meta.reason', 'no-graph-yet')
            ->assertJsonPath('errors', []);
    });

    it('returns folder nodes and weighted links matching buildGraphView', function () {
        foreach (['app/A.php', 'app/B.php', 'lib/C.php', 'lib/D.php'] as $path) {
            $this->project->files()->create(['path' => $path, 'size' => 1, 'lang' => 'php']);
        }
        GraphSnapshot::factory()->create([
            'project_id' => $this->project->id,
            'edges' => [
                ['from' => 'app/A.php', 'to' => 'lib/C.php', 'kind' => 'import', 'line' => 1],
                ['from' => 'app/B.php', 'to' => 'lib/D.php', 'kind' => 'import', 'line' => 2],
            ],
        ]);

        $body = $this->getJson("/api/v1/projects/{$this->project->id}/graph/rollup")
            ->assertOk()
            ->assertJsonMissingPath('data.edges')
            ->assertJsonMissingPath('meta.page')
            ->assertJsonMissingPath('meta.per_page')
            ->json();

        expect($body['meta']['cap'])->toBe(1)
            ->and($body['meta']['truncated'])->toBeFalse()
            ->and($body['meta']['total'])->toBe(2)
            ->and($body['meta']['returned'])->toBe(2)
            ->and($body['data']['nodes'])->toHaveCount(2)
            ->and(array_column($body['data']['nodes'], 'kind'))->each->toBe('folder')
            ->and($body['data']['links'])->toHaveCount(1)
            ->and($body['data']['links'][0]['weight'])->toBe(2);

        $byId = collect($body['data']['nodes'])->keyBy('id');
        expect($byId['dir:app']['fileCount'])->toBe(2)
            ->and($byId['dir:lib']['fileCount'])->toBe(2);
    });

    it('clamps depth to 1..4 and defaults to 1', function () {
        $this->project->files()->create(['path' => 'app/A.php', 'size' => 1, 'lang' => 'php']);
        GraphSnapshot::factory()->create([
            'project_id' => $this->project->id,
            'edges' => [],
        ]);

        $this->getJson("/api/v1/projects/{$this->project->id}/graph/rollup")
            ->assertOk()
            ->assertJsonPath('meta.cap', 1);

        $this->getJson("/api/v1/projects/{$this->project->id}/graph/rollup?depth=0")
            ->assertOk()
            ->assertJsonPath('meta.cap', 1);

        $this->getJson("/api/v1/projects/{$this->project->id}/graph/rollup?depth=99")
            ->assertOk()
            ->assertJsonPath('meta.cap', 4);
    });

    it('rejects a non-numeric depth with a 422 field-path violation', function () {
        GraphSnapshot::factory()->create([
            'project_id' => $this->project->id,
            'edges' => [],
        ]);

        $this->getJson("/api/v1/projects/{$this->project->id}/graph/rollup?depth=abc")
            ->assertStatus(422)
            ->assertJsonPath('errors.0.violations.0.field', 'depth');
    });

    it('does not change GET /graph data shape', function () {
        $edges = [
            ['from' => 'app/A.php', 'to' => 'lib/C.php', 'kind' => 'import', 'line' => 1],
        ];
        GraphSnapshot::factory()->create([
            'project_id' => $this->project->id,
            'edges' => $edges,
        ]);

        $body = $this->getJson("/api/v1/projects/{$this->project->id}/graph")
            ->assertOk()
            ->json('data');

        expect(array_keys($body))->toBe(['projectId', 'scannedAt', 'edges']);
    });

    it('serves cached rollup until forgetGraph clears the depth bucket', function () {
        $this->project->files()->create(['path' => 'app/A.php', 'size' => 1, 'lang' => 'php']);
        $this->project->files()->create(['path' => 'lib/B.php', 'size' => 1, 'lang' => 'php']);
        GraphSnapshot::factory()->create([
            'project_id' => $this->project->id,
            'scanned_at' => now()->subMinute(),
            'edges' => [
                ['from' => 'app/A.php', 'to' => 'lib/B.php', 'kind' => 'import', 'line' => 1],
            ],
        ]);

        $first = $this->getJson("/api/v1/projects/{$this->project->id}/graph/rollup?depth=1")
            ->assertOk()
            ->json('data.links');
        expect($first)->toHaveCount(1);

        GraphSnapshot::factory()->create([
            'project_id' => $this->project->id,
            'scanned_at' => now(),
            'edges' => [],
        ]);

        $cached = $this->getJson("/api/v1/projects/{$this->project->id}/graph/rollup?depth=1")
            ->assertOk()
            ->json('data.links');
        expect($cached)->toBe($first);

        ProjectReadCache::forgetGraph($this->project->id);

        $fresh = $this->getJson("/api/v1/projects/{$this->project->id}/graph/rollup?depth=1")
            ->assertOk()
            ->json('data.links');
        expect($fresh)->toBe([]);
    });
});

describe('Graph neighbourhood API', function () {
    beforeEach(function () {
        asUser();
        Cache::flush();
        $this->project = Project::factory()->create(['name' => 'neighbourhood-fixture']);
    });

    it('returns no-graph-yet with data null when no snapshot exists', function () {
        $this->getJson("/api/v1/projects/{$this->project->id}/graph/neighbourhood?focus=app/A.php")
            ->assertOk()
            ->assertJsonPath('data', null)
            ->assertJsonPath('meta.reason', 'no-graph-yet')
            ->assertJsonPath('errors', []);
    });

    it('returns the C7 envelope with file nodes, links, and clamp meta', function () {
        foreach (['app/A.php', 'app/B.php', 'lib/C.php', 'lib/D.php'] as $path) {
            $this->project->files()->create(['path' => $path, 'size' => 1, 'lang' => 'php']);
        }
        GraphSnapshot::factory()->create([
            'project_id' => $this->project->id,
            'edges' => [
                ['from' => 'app/A.php', 'to' => 'lib/C.php', 'kind' => 'import', 'line' => 1],
                ['from' => 'app/B.php', 'to' => 'lib/D.php', 'kind' => 'import', 'line' => 2],
            ],
        ]);

        $body = $this->getJson("/api/v1/projects/{$this->project->id}/graph/neighbourhood?focus=dir:app&radius=1")
            ->assertOk()
            ->assertJsonMissingPath('data.edges')
            ->assertJsonMissingPath('data.files')
            ->assertJsonMissingPath('data.nodes.0.color')
            ->assertJsonMissingPath('meta.page')
            ->assertJsonMissingPath('meta.per_page')
            ->json();

        expect($body['meta']['radius'])->toBe(1)
            ->and($body['meta']['focus'])->toBe('dir:app')
            ->and($body['meta']['truncated'])->toBeFalse()
            ->and($body['meta']['returned'])->toBe(4)
            ->and($body['meta']['total'])->toBe(4)
            ->and($body['data']['projectId'])->toBe($this->project->id)
            ->and(array_column($body['data']['nodes'], 'kind'))->each->toBe('file')
            ->and($body['data']['links'])->toHaveCount(2);
    });

    it('clamps radius to 1..3 and defaults to 1', function () {
        $this->project->files()->create(['path' => 'app/A.php', 'size' => 1, 'lang' => 'php']);
        GraphSnapshot::factory()->create([
            'project_id' => $this->project->id,
            'edges' => [],
        ]);

        $this->getJson("/api/v1/projects/{$this->project->id}/graph/neighbourhood?focus=app/A.php")
            ->assertOk()
            ->assertJsonPath('meta.radius', 1);

        $this->getJson("/api/v1/projects/{$this->project->id}/graph/neighbourhood?focus=app/A.php&radius=0")
            ->assertOk()
            ->assertJsonPath('meta.radius', 1);

        $this->getJson("/api/v1/projects/{$this->project->id}/graph/neighbourhood?focus=app/A.php&radius=99")
            ->assertOk()
            ->assertJsonPath('meta.radius', 3);
    });

    it('rejects a missing or non-numeric neighbourhood query with a 422 field-path violation', function () {
        GraphSnapshot::factory()->create([
            'project_id' => $this->project->id,
            'edges' => [],
        ]);

        $this->getJson("/api/v1/projects/{$this->project->id}/graph/neighbourhood")
            ->assertStatus(422)
            ->assertJsonPath('errors.0.violations.0.field', 'focus');

        $this->getJson("/api/v1/projects/{$this->project->id}/graph/neighbourhood?focus=app/A.php&radius=abc")
            ->assertStatus(422)
            ->assertJsonPath('errors.0.violations.0.field', 'radius');
    });

    it('does not change GET /graph data shape', function () {
        $edges = [
            ['from' => 'app/A.php', 'to' => 'lib/C.php', 'kind' => 'import', 'line' => 1],
        ];
        GraphSnapshot::factory()->create([
            'project_id' => $this->project->id,
            'edges' => $edges,
        ]);

        $body = $this->getJson("/api/v1/projects/{$this->project->id}/graph")
            ->assertOk()
            ->json('data');

        expect(array_keys($body))->toBe(['projectId', 'scannedAt', 'edges']);
    });

    it('clamps neighbourhood size to the configured hard max', function () {
        config(['graph.aggregate_max_nodes' => 2]);
        foreach (['app/hub.php', 'lib/a.php', 'lib/b.php', 'lib/c.php'] as $path) {
            $this->project->files()->create(['path' => $path, 'size' => 1, 'lang' => 'php']);
        }
        GraphSnapshot::factory()->create([
            'project_id' => $this->project->id,
            'edges' => [
                ['from' => 'app/hub.php', 'to' => 'lib/a.php', 'kind' => 'import', 'line' => 1],
                ['from' => 'app/hub.php', 'to' => 'lib/b.php', 'kind' => 'import', 'line' => 2],
                ['from' => 'app/hub.php', 'to' => 'lib/c.php', 'kind' => 'import', 'line' => 3],
            ],
        ]);

        $body = $this->getJson("/api/v1/projects/{$this->project->id}/graph/neighbourhood?focus=app/hub.php")
            ->assertOk()
            ->json();

        expect($body['meta']['cap'])->toBe(2)
            ->and($body['meta']['truncated'])->toBeTrue()
            ->and($body['meta']['total'])->toBe(4)
            ->and($body['meta']['returned'])->toBe(2)
            ->and($body['data']['nodes'])->toHaveCount(2)
            ->and(array_column($body['data']['nodes'], 'id'))->toContain('app/hub.php');
    });

    it('serves cached neighbourhood until forgetGraph clears the focus bucket', function () {
        $this->project->files()->create(['path' => 'app/A.php', 'size' => 1, 'lang' => 'php']);
        $this->project->files()->create(['path' => 'lib/B.php', 'size' => 1, 'lang' => 'php']);
        GraphSnapshot::factory()->create([
            'project_id' => $this->project->id,
            'scanned_at' => now()->subMinute(),
            'edges' => [
                ['from' => 'app/A.php', 'to' => 'lib/B.php', 'kind' => 'import', 'line' => 1],
            ],
        ]);

        $first = $this->getJson("/api/v1/projects/{$this->project->id}/graph/neighbourhood?focus=app/A.php&radius=1")
            ->assertOk()
            ->json('data.links');
        expect($first)->toHaveCount(1);

        GraphSnapshot::factory()->create([
            'project_id' => $this->project->id,
            'scanned_at' => now(),
            'edges' => [],
        ]);

        $cached = $this->getJson("/api/v1/projects/{$this->project->id}/graph/neighbourhood?focus=app/A.php&radius=1")
            ->assertOk()
            ->json('data.links');
        expect($cached)->toBe($first);

        ProjectReadCache::forgetGraph($this->project->id);

        $fresh = $this->getJson("/api/v1/projects/{$this->project->id}/graph/neighbourhood?focus=app/A.php&radius=1")
            ->assertOk()
            ->json('data.links');
        expect($fresh)->toBe([]);
    });
});
