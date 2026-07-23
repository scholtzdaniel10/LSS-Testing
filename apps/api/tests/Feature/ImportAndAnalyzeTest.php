<?php

use App\Models\JobStatus;
use App\Models\Project;
use App\Services\Diagnostics\AnalysisRunner;
use App\Services\Diagnostics\PhpStanAdapter;
use App\Support\Sandbox\PathJail;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

beforeEach(function () {
    Storage::fake('local');
    config(['sandbox.root' => storage_path('framework/testing/sandboxes-'.Str::random(6))]);
});

it('imports a zip into the sandbox and records project files (IG-19)', function () {
    asUser();

    $project = Project::query()->create(['name' => 'import-demo']);

    $zipPath = tempnam(sys_get_temp_dir(), 'lss').'.zip';
    $zip = new ZipArchive;
    $zip->open($zipPath, ZipArchive::CREATE);
    $zip->addFromString('src/Hello.php', "<?php\nEcho 'hi';\n");
    $zip->addFromString('node_modules/left-pad/index.js', 'module.exports = 1');
    $zip->addFromString('package.json', '{"name":"demo","dependencies":{"react":"19.0.0"}}');
    $zip->close();

    $upload = new UploadedFile($zipPath, 'demo.zip', 'application/zip', null, true);

    $response = $this->post("/api/v1/projects/{$project->id}/import", [
        'archive' => $upload,
        'name' => 'import-demo',
    ], ['Accept' => 'application/json']);

    $response->assertAccepted();
    $jobId = $response->json('data.jobId');
    $job = JobStatus::query()->find($jobId);
    expect($job?->status)->toBe(JobStatus::STATUS_DONE)
        ->and($job?->result)->toHaveKeys(['analyzeJobId', 'snapshotJobId']);

    $project->refresh();
    expect($project->last_imported_at)->not->toBeNull()
        ->and($project->files()->where('path', 'src/Hello.php')->exists())->toBeTrue()
        ->and($project->files()->where('path', 'like', 'node_modules%')->exists())->toBeFalse()
        ->and($project->usageReport)->not->toBeNull();

    expect(JobStatus::query()->find($job->result['analyzeJobId'])?->status)->toBe(JobStatus::STATUS_DONE);

    $tree = $this->getJson("/api/v1/projects/{$project->id}/tree");
    $tree->assertOk();
    expect($tree->json('data'))->toBeArray()->not->toBeEmpty();

    $file = $this->getJson("/api/v1/projects/{$project->id}/file?path=src/Hello.php");
    $file->assertOk();
    expect($file->json('data.content'))->toContain('hi');

    $traversal = $this->getJson("/api/v1/projects/{$project->id}/file?path=../etc/passwd");
    $traversal->assertForbidden();

    @unlink($zipPath);
});

it('flattens a single top-level wrapper folder in uploaded zips (IG-19)', function () {
    asUser();

    $project = Project::query()->create(['name' => 'wrapped']);

    $zipPath = tempnam(sys_get_temp_dir(), 'lss').'.zip';
    $zip = new ZipArchive;
    $zip->open($zipPath, ZipArchive::CREATE);
    $zip->addFromString('LSS-Testing/README.md', "# demo\n");
    $zip->addFromString('LSS-Testing/apps/api/routes/api.php', "<?php\n");
    $zip->close();

    $upload = new UploadedFile($zipPath, 'wrapped.zip', 'application/zip', null, true);

    $response = $this->post("/api/v1/projects/{$project->id}/import", [
        'archive' => $upload,
        'name' => 'wrapped',
    ], ['Accept' => 'application/json']);

    $response->assertAccepted();

    $project->refresh();
    expect($project->files()->where('path', 'README.md')->exists())->toBeTrue()
        ->and($project->files()->where('path', 'apps/api/routes/api.php')->exists())->toBeTrue()
        ->and($project->files()->where('path', 'like', 'LSS-Testing%')->exists())->toBeFalse();

    @unlink($zipPath);
});

it('queues analyze and persists evidence-gated findings (DX-3/DX-17)', function () {
    asUser();

    $project = Project::query()->create(['name' => 'analyze-demo']);
    $jail = PathJail::fromConfig();
    $root = $jail->projectRoot($project->id);
    mkdir($root.DIRECTORY_SEPARATOR.'src', 0755, true);
    file_put_contents($root.DIRECTORY_SEPARATOR.'src'.DIRECTORY_SEPARATOR.'A.php', "<?php\n");

    $project->update(['sandbox_path' => $root, 'last_imported_at' => now()]);
    $project->files()->create(['path' => 'src/A.php', 'size' => 6, 'lang' => 'php']);

    $json = json_encode([
        'files' => [
            $root.'/src/A.php' => [
                'messages' => [
                    [
                        'message' => 'Seeded defect A',
                        'line' => 1,
                        'identifier' => 'argument.type',
                    ],
                ],
            ],
        ],
    ], JSON_THROW_ON_ERROR);

    $this->app->instance(
        AnalysisRunner::class,
        AnalysisRunner::withDefaults(PhpStanAdapter::withJsonRunner(fn () => $json)),
    );

    $response = $this->postJson("/api/v1/projects/{$project->id}/analyze");
    $response->assertAccepted();

    $errors = $this->getJson("/api/v1/projects/{$project->id}/errors");
    $errors->assertOk();
    expect($errors->json('data'))->toHaveCount(1)
        ->and($errors->json('data.0.ruleId'))->toBe('argument.type')
        ->and($errors->json('data.0.range.startLine'))->toBe(1);
});

it('re-scan queues analyze then snapshot chain (UI-4)', function () {
    // QUEUE_CONNECTION=sync in phpunit: chain runs inline before the 202 returns.
    asUser();

    $project = Project::query()->create(['name' => 'rescan-demo']);
    $jail = PathJail::fromConfig();
    $root = $jail->projectRoot($project->id);
    mkdir($root.DIRECTORY_SEPARATOR.'src', 0755, true);
    file_put_contents($root.DIRECTORY_SEPARATOR.'src'.DIRECTORY_SEPARATOR.'A.php', "<?php\n");

    $project->update(['sandbox_path' => $root, 'last_imported_at' => now()]);
    $project->files()->create(['path' => 'src/A.php', 'size' => 6, 'lang' => 'php']);

    $this->app->instance(
        AnalysisRunner::class,
        AnalysisRunner::withDefaults(PhpStanAdapter::withJsonRunner(fn () => '{"files":[]}')),
    );

    $response = $this->postJson("/api/v1/projects/{$project->id}/rescan");
    $response->assertAccepted();

    $analyzeStatus = JobStatus::query()->findOrFail($response->json('data.analyzeJobId'));
    $snapshotStatus = JobStatus::query()->findOrFail($response->json('data.snapshotJobId'));
    expect($analyzeStatus->status)->toBe(JobStatus::STATUS_DONE)
        ->and($snapshotStatus->status)->toBe(JobStatus::STATUS_DONE);

    $this->getJson("/api/v1/projects/{$project->id}/health-report")->assertOk();
});

it('precision harness finds every seeded defect ruleId+line (DX-17a)', function () {
    $seeded = [
        ['ruleId' => 'property.nonObject', 'line' => 11],
        ['ruleId' => 'return.type', 'line' => 16],
        ['ruleId' => 'variable.undefined', 'line' => 21],
        ['ruleId' => 'argument.type', 'line' => 26],
        ['ruleId' => 'class.notFound', 'line' => 32],
    ];

    $messages = array_map(fn (array $s): array => [
        'message' => 'seeded '.$s['ruleId'],
        'line' => $s['line'],
        'identifier' => $s['ruleId'],
    ], $seeded);

    $json = json_encode([
        'files' => [
            '/sandbox/src/Defects.php' => ['messages' => $messages],
        ],
    ], JSON_THROW_ON_ERROR);

    $findings = PhpStanAdapter::withJsonRunner(fn () => $json)->run('/sandbox');
    $indexed = [];
    foreach ($findings as $f) {
        $indexed[$f['ruleId'].':'.$f['range']['startLine']] = true;
    }

    foreach ($seeded as $s) {
        expect($indexed[$s['ruleId'].':'.$s['line']] ?? false)->toBeTrue();
    }
});
