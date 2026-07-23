<?php

use App\Jobs\AnalyzeProject;
use App\Models\JobStatus;
use App\Models\Project;
use App\Models\Scan;
use App\Services\Diagnostics\AnalysisRunner;
use App\Services\Diagnostics\Analyzer;
use App\Services\Graph\DependencyGraphBuilder;
use App\Services\Graph\IncrementalGraphBuilder;
use App\Services\Import\UsageReportBuilder;
use App\Support\Sandbox\ProjectWorkspace;

/**
 * DX-7 AC (note 04): golden-file test — seeded broken function in fixture
 * → the known 3 downstream files are found on the persisted error.
 */
it('joins persisted errors onto graph edges with upstream and downstream (DX-7)', function () {
    $fixture = base_path('tests/fixtures/impact-chain');
    config([
        'sandbox.allow_local_link' => true,
        'sandbox.local_path_prefixes' => [base_path('tests/fixtures')],
    ]);

    $project = Project::query()->create([
        'name' => 'impact-chain',
        'source_type' => 'local',
        'local_source_path' => $fixture,
    ]);
    foreach (['a.php', 'b.php', 'c.php', 'd.php'] as $path) {
        $project->files()->create(['path' => $path, 'size' => 1, 'lang' => 'php']);
    }
    $status = JobStatus::query()->create([
        'type' => 'analyze',
        'project_id' => $project->id,
        'status' => JobStatus::STATUS_QUEUED,
    ]);

    // Fake analyser: one real-shaped finding on the chain root, one on the leaf.
    $fake = new class implements Analyzer
    {
        public function source(): string
        {
            return 'fake';
        }

        public function runStatus(): ?string
        {
            return 'ok';
        }

        public function run(string $sandboxPath): array
        {
            $finding = static fn (string $file): array => [
                'source' => 'fake',
                'ruleId' => 'return.type',
                'kind' => 'type-error',
                'severity' => 'error',
                'file' => $file,
                'range' => ['startLine' => 6, 'startCol' => 0, 'endLine' => 6, 'endCol' => 10],
                'message' => 'Function returns string but declares int.',
            ];

            return [$finding('a.php'), $finding('d.php')];
        }
    };

    (new AnalyzeProject($project->id, $status->id))->handle(
        app(ProjectWorkspace::class),
        app(UsageReportBuilder::class),
        app(DependencyGraphBuilder::class),
        AnalysisRunner::withAdapters([$fake]),
        app(IncrementalGraphBuilder::class),
    );

    expect($status->fresh()->status)->toBe(JobStatus::STATUS_DONE);

    /** @var Scan $scan */
    $scan = $project->scans()->latest('created_at')->firstOrFail();
    $rootError = $scan->errors()->where('file', 'a.php')->firstOrFail();
    $leafError = $scan->errors()->where('file', 'd.php')->firstOrFail();

    // Golden: a.php has exactly the 3 known dependents, nearest first.
    expect($rootError->downstream)->toBe(['b.php', 'c.php', 'd.php'])
        ->and($rootError->upstream)->toBe([]);

    // Leaf: nothing depends on d.php; it depends directly on c.php.
    expect($leafError->downstream)->toBe([])
        ->and($leafError->upstream)->toBe(['c.php']);
});
