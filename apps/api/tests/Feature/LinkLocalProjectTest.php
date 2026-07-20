<?php

use App\Models\JobStatus;
use App\Models\Project;
use Illuminate\Support\Facades\File;

beforeEach(function () {
    config(['sandbox.allow_local_link' => true, 'sandbox.local_path_prefixes' => []]);
});

it('links a local folder and indexes files without zip upload', function () {
    asUser();

    $root = storage_path('framework/testing/local-link-'.uniqid());
    File::ensureDirectoryExists($root.'/src');
    File::ensureDirectoryExists($root.'/node_modules/pkg');
    file_put_contents($root.'/src/Hello.php', "<?php\nnamespace App;\nclass Hello {}\n");
    file_put_contents($root.'/node_modules/pkg/index.js', 'module.exports = 1');

    $project = Project::query()->create(['name' => 'local-demo']);

    $response = $this->postJson("/api/v1/projects/{$project->id}/link-local", [
        'path' => $root,
    ], ['Accept' => 'application/json']);

    $response->assertAccepted();
    $jobId = $response->json('data.jobId');
    expect(JobStatus::query()->find($jobId)?->status)->toBe(JobStatus::STATUS_DONE);

    $project->refresh();
    expect($project->source_type)->toBe('local')
        ->and($project->local_source_path)->toBe(realpath($root))
        ->and($project->last_imported_at)->not->toBeNull()
        ->and($project->files()->where('path', 'src/Hello.php')->exists())->toBeTrue()
        ->and($project->files()->where('path', 'like', 'node_modules%')->exists())->toBeFalse();

    $tree = $this->getJson("/api/v1/projects/{$project->id}/tree");
    $tree->assertOk();
    expect($tree->json('data'))->not->toBeEmpty();

    File::deleteDirectory($root);
});

it('rejects local paths outside configured prefixes', function () {
    asUser();
    config(['sandbox.local_path_prefixes' => [storage_path('framework/testing/allowed')]]);

    $root = storage_path('framework/testing/blocked-'.uniqid());
    File::ensureDirectoryExists($root);

    $project = Project::query()->create(['name' => 'blocked']);

    $this->postJson("/api/v1/projects/{$project->id}/link-local", [
        'path' => $root,
    ])->assertStatus(500);

    File::deleteDirectory($root);
});

it('does not delete the user folder when deleting a local-linked project', function () {
    asUser();

    $root = storage_path('framework/testing/local-keep-'.uniqid());
    File::ensureDirectoryExists($root);
    file_put_contents($root.'/keep.txt', 'stay');

    $project = Project::query()->create(['name' => 'keep-local']);
    $this->postJson("/api/v1/projects/{$project->id}/link-local", ['path' => $root])->assertAccepted();

    $this->deleteJson("/api/v1/projects/{$project->id}")->assertOk();
    expect(is_dir($root))->toBeTrue()
        ->and(is_file($root.'/keep.txt'))->toBeTrue();

    File::deleteDirectory($root);
});
