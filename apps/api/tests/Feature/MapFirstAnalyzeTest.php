<?php

use App\Jobs\BuildHealthSnapshot;
use App\Jobs\BuildProjectMap;
use App\Jobs\DiagnoseProject;
use App\Models\JobStatus;
use App\Models\Project;
use App\Services\Diagnostics\AnalysisRunner;
use App\Services\Diagnostics\PhpStanAdapter;
use App\Services\Graph\DependencyGraphBuilder;
use App\Services\Graph\IncrementalGraphBuilder;
use App\Services\Import\UsageReportBuilder;
use App\Support\Jobs\DispatchAnalyzeChain;
use App\Support\Sandbox\PathJail;
use App\Support\Sandbox\ProjectWorkspace;
use Illuminate\Support\Facades\Bus;

it('dispatches map then diagnose job statuses after analyze/rescan queue', function () {
    asUser();

    $project = Project::query()->create(['name' => 'map-first-chain']);
    $jail = PathJail::fromConfig();
    $root = $jail->projectRoot($project->id);
    mkdir($root.DIRECTORY_SEPARATOR.'src', 0755, true);
    file_put_contents($root.DIRECTORY_SEPARATOR.'src'.DIRECTORY_SEPARATOR.'A.php', "<?php\n");
    $project->update(['sandbox_path' => $root, 'last_imported_at' => now()]);
    $project->files()->create(['path' => 'src/A.php', 'size' => 6, 'lang' => 'php']);

    Bus::fake();

    $ids = DispatchAnalyzeChain::dispatch($project->id);

    expect($ids)->toHaveKeys(['mapJobId', 'diagnoseJobId', 'analyzeJobId', 'snapshotJobId'])
        ->and($ids['analyzeJobId'])->toBe($ids['diagnoseJobId']);

    $map = JobStatus::query()->findOrFail($ids['mapJobId']);
    $diagnose = JobStatus::query()->findOrFail($ids['diagnoseJobId']);
    expect($map->type)->toBe('build-map')
        ->and($map->status)->toBe(JobStatus::STATUS_QUEUED)
        ->and($diagnose->type)->toBe('diagnose')
        ->and($diagnose->status)->toBe(JobStatus::STATUS_QUEUED);

    Bus::assertChained([
        BuildProjectMap::class,
        DiagnoseProject::class,
        BuildHealthSnapshot::class,
    ]);
});

it('serves graph before diagnose completes', function () {
    asUser();

    $project = Project::query()->create(['name' => 'map-before-diagnose']);
    $jail = PathJail::fromConfig();
    $root = $jail->projectRoot($project->id);
    mkdir($root.DIRECTORY_SEPARATOR.'src', 0755, true);
    file_put_contents(
        $root.DIRECTORY_SEPARATOR.'src'.DIRECTORY_SEPARATOR.'A.php',
        "<?php\nnamespace App;\nclass A {}\n",
    );
    $project->update(['sandbox_path' => $root, 'last_imported_at' => now()]);
    $project->files()->create(['path' => 'src/A.php', 'size' => 40, 'lang' => 'php']);

    $mapStatus = JobStatus::query()->create([
        'type' => 'build-map',
        'project_id' => $project->id,
        'status' => JobStatus::STATUS_QUEUED,
    ]);
    $diagnoseStatus = JobStatus::query()->create([
        'type' => 'diagnose',
        'project_id' => $project->id,
        'status' => JobStatus::STATUS_QUEUED,
    ]);

    (new BuildProjectMap($project->id, $mapStatus->id))->handle(
        app(ProjectWorkspace::class),
        app(UsageReportBuilder::class),
        app(DependencyGraphBuilder::class),
        app(IncrementalGraphBuilder::class),
    );

    expect($mapStatus->fresh()->status)->toBe(JobStatus::STATUS_DONE)
        ->and($diagnoseStatus->fresh()->status)->toBe(JobStatus::STATUS_QUEUED);

    $graph = $this->getJson("/api/v1/projects/{$project->id}/graph");
    $graph->assertOk();
    expect($graph->json('data.edges'))->toBeArray();

    $rollup = $this->getJson("/api/v1/projects/{$project->id}/graph/rollup");
    $rollup->assertOk();

    expect($project->scans()->count())->toBe(0);

    $this->app->forgetInstance(AnalysisRunner::class);
    $this->app->instance(
        AnalysisRunner::class,
        AnalysisRunner::withAdapters([
            PhpStanAdapter::withJsonRunner(fn () => '{"files":[]}'),
        ]),
    );

    (new DiagnoseProject($project->id, $diagnoseStatus->id))->handle(
        app(ProjectWorkspace::class),
        app(AnalysisRunner::class),
        app(IncrementalGraphBuilder::class),
    );

    expect($diagnoseStatus->fresh()->status)->toBe(JobStatus::STATUS_DONE)
        ->and($project->scans()->where('status', 'done')->exists())->toBeTrue();
});
