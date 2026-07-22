<?php

/**
 * DSK-7 — Local roots CRUD + link-local integration.
 */

use App\Models\LocalRoot;
use App\Models\Project;
use App\Support\Sandbox\ProjectWorkspace;
use Illuminate\Support\Facades\File;

// ── CRUD ─────────────────────────────────────────────────────────────────────

it('lists local roots (empty)', function () {
    asUser();
    $this->getJson('/api/v1/local-roots')
        ->assertOk()
        ->assertJson(['data' => [], 'errors' => []]);
});

it('adds a local root and lists it', function () {
    asUser();
    $dir = storage_path('framework/testing/root-add-' . uniqid());
    File::ensureDirectoryExists($dir);

    $response = $this->postJson('/api/v1/local-roots', ['path' => $dir]);
    $response->assertStatus(201)
        ->assertJsonPath('data.path', rtrim($dir, '/\\'));

    $this->getJson('/api/v1/local-roots')
        ->assertOk()
        ->assertJsonCount(1, 'data');

    File::deleteDirectory($dir);
});

it('adding a root is idempotent — returns 200 on second POST', function () {
    asUser();
    $dir = storage_path('framework/testing/root-idem-' . uniqid());
    File::ensureDirectoryExists($dir);

    $first  = $this->postJson('/api/v1/local-roots', ['path' => $dir]);
    $second = $this->postJson('/api/v1/local-roots', ['path' => $dir]);

    $first->assertStatus(201);
    $second->assertStatus(200);
    expect($first->json('data.id'))->toBe($second->json('data.id'));

    expect(LocalRoot::query()->where('path', rtrim($dir, '/\\'))->count())->toBe(1);

    File::deleteDirectory($dir);
});

it('removes a local root', function () {
    asUser();
    $dir = storage_path('framework/testing/root-del-' . uniqid());
    File::ensureDirectoryExists($dir);

    $id = $this->postJson('/api/v1/local-roots', ['path' => $dir])->json('data.id');

    $this->deleteJson("/api/v1/local-roots/{$id}")->assertStatus(204);
    $this->getJson('/api/v1/local-roots')->assertJsonCount(0, 'data');

    File::deleteDirectory($dir);
});

// ── Validation ────────────────────────────────────────────────────────────────

it('rejects a relative path with 422', function () {
    asUser();
    $this->postJson('/api/v1/local-roots', ['path' => 'relative/path'])
        ->assertStatus(422)
        ->assertJsonPath('errors.0.title', 'Invalid path');
});

it('rejects a nonexistent directory with 422', function () {
    asUser();
    $this->postJson('/api/v1/local-roots', ['path' => 'C:\\DoesNotExist\\' . uniqid()])
        ->assertStatus(422)
        ->assertJsonPath('errors.0.title', 'Directory not found');
});

// ── Link-local integration ────────────────────────────────────────────────────

it('link-local succeeds when path is under a registered root', function () {
    asUser();
    config(['sandbox.allow_local_link' => true, 'sandbox.local_path_prefixes' => []]);

    $root    = storage_path('framework/testing/root-link-' . uniqid());
    $subdir  = $root . '/my-project';
    File::ensureDirectoryExists($subdir);
    file_put_contents($subdir . '/hello.php', "<?php\necho 'hi';\n");

    // Register the parent as an allowed root.
    LocalRoot::query()->create(['path' => rtrim($root, '/\\')]);

    $project  = Project::query()->create(['name' => 'link-test']);
    $response = $this->postJson("/api/v1/projects/{$project->id}/link-local", ['path' => $subdir]);
    $response->assertAccepted();

    File::deleteDirectory($root);
});

it('link-local fails with 422 + path_not_allowed code when path is outside all registered roots', function () {
    asUser();
    config(['sandbox.allow_local_link' => true, 'sandbox.local_path_prefixes' => []]);

    $outsideDir = storage_path('framework/testing/outside-' . uniqid());
    File::ensureDirectoryExists($outsideDir);

    // No root registered at all.
    $project  = Project::query()->create(['name' => 'blocked']);
    $response = $this->postJson("/api/v1/projects/{$project->id}/link-local", ['path' => $outsideDir]);

    $response->assertStatus(422)
        ->assertJsonPath('errors.0.code', 'path_not_allowed')
        ->assertJsonPath('errors.0.title', 'Path not allowed');

    // rejectedPath extension echoes the (real) path that was refused.
    expect($response->json('errors.0.rejectedPath'))->toBeString();

    File::deleteDirectory($outsideDir);
});

it('delete removes root and blocks new links but does not affect existing projects', function () {
    asUser();
    config(['sandbox.allow_local_link' => true, 'sandbox.local_path_prefixes' => []]);

    $root   = storage_path('framework/testing/root-dbl-' . uniqid());
    $subdir = $root . '/proj';
    File::ensureDirectoryExists($subdir);
    file_put_contents($subdir . '/main.php', '<?php');

    $rootRecord = LocalRoot::query()->create(['path' => rtrim($root, '/\\')]);

    // Link succeeds with the root registered.
    $project = Project::query()->create(['name' => 'dbl-test']);
    $this->postJson("/api/v1/projects/{$project->id}/link-local", ['path' => $subdir])
        ->assertAccepted();

    // Remove the root.
    $this->deleteJson("/api/v1/local-roots/{$rootRecord->id}")->assertStatus(204);

    // A second project can no longer link to that directory.
    $project2 = Project::query()->create(['name' => 'dbl-test-2']);
    $this->postJson("/api/v1/projects/{$project2->id}/link-local", ['path' => $subdir])
        ->assertStatus(422)
        ->assertJsonPath('errors.0.code', 'path_not_allowed');

    File::deleteDirectory($root);
});

// ── Separator-safety ──────────────────────────────────────────────────────────

it('pathIsUnderAnyPrefix: C:\\LSS does not match C:\\LSSX', function () {
    $prefixes = ['C:\\LSSX'];
    expect(ProjectWorkspace::pathIsUnderAnyPrefix('C:\\LSS', $prefixes))->toBeFalse();
});

it('pathIsUnderAnyPrefix: C:\\LSS matches itself', function () {
    $prefixes = ['C:\\LSS'];
    expect(ProjectWorkspace::pathIsUnderAnyPrefix('C:\\LSS', $prefixes))->toBeTrue();
});

it('pathIsUnderAnyPrefix: C:\\LSS\\sub matches C:\\LSS', function () {
    $prefixes = ['C:\\LSS'];
    expect(ProjectWorkspace::pathIsUnderAnyPrefix('C:\\LSS\\sub', $prefixes))->toBeTrue();
});

it('pathIsUnderAnyPrefix: case-insensitive on Windows-style paths', function () {
    $prefixes = ['c:\\lss'];
    expect(ProjectWorkspace::pathIsUnderAnyPrefix('C:\\LSS\\Sub', $prefixes))->toBeTrue();
});

it('pathIsUnderAnyPrefix: forward-slash normalisation works', function () {
    $prefixes = ['C:/LSS'];
    expect(ProjectWorkspace::pathIsUnderAnyPrefix('C:\\LSS\\sub', $prefixes))->toBeTrue();
});

it('pathIsUnderAnyPrefix: env prefix takes effect when no DB roots registered', function () {
    asUser();
    config(['sandbox.allow_local_link' => true, 'sandbox.local_path_prefixes' => [storage_path('framework/testing')]]);

    $dir = storage_path('framework/testing/env-prefix-' . uniqid());
    File::ensureDirectoryExists($dir);

    $project = Project::query()->create(['name' => 'env-prefix-test']);
    $this->postJson("/api/v1/projects/{$project->id}/link-local", ['path' => $dir])
        ->assertAccepted();

    File::deleteDirectory($dir);
});
