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
 * DX-8 AC: cascading fixture (one broken class, 4 consequent errors) groups
 * into 1 chain with the correct root.
 * DX-9 AC: depth 1 vs 3 downstream counts differ as expected on the fixture.
 */
function runImpactChainScan(): Project
{
    $fixture = base_path('tests/fixtures/impact-chain');
    config([
        'sandbox.allow_local_link' => true,
        'sandbox.local_path_prefixes' => [base_path('tests/fixtures')],
    ]);

    $project = Project::query()->create([
        'name' => 'cascade',
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

    // One broken class in a.php; three consequent errors down the chain.
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
            $finding = static fn (string $file, string $message): array => [
                'source' => 'fake',
                'ruleId' => 'class.broken',
                'kind' => 'type-error',
                'severity' => 'error',
                'file' => $file,
                'range' => ['startLine' => 6, 'startCol' => 0, 'endLine' => 6, 'endCol' => 10],
                'message' => $message,
            ];

            return [
                $finding('a.php', 'Broken class: return type mismatch.'),
                $finding('b.php', 'Call to broken() with incompatible return.'),
                $finding('c.php', 'useA() propagates the broken value.'),
                $finding('d.php', 'useB() propagates the broken value.'),
            ];
        }
    };

    (new AnalyzeProject($project->id, $status->id))->handle(
        app(ProjectWorkspace::class),
        app(UsageReportBuilder::class),
        app(DependencyGraphBuilder::class),
        AnalysisRunner::withAdapters([$fake]),
        app(IncrementalGraphBuilder::class),
    );

    return $project;
}

it('groups cascading errors into one chain with the most-upstream root (DX-8)', function () {
    $project = runImpactChainScan();
    /** @var Scan $scan */
    $scan = $project->scans()->latest('created_at')->firstOrFail();
    $errors = $scan->errors()->get();

    expect($errors)->toHaveCount(4);

    $chainIds = $errors->pluck('chain_id')->unique()->filter();
    expect($chainIds)->toHaveCount(1, 'all 4 errors share one chain');

    $roots = $errors->where('is_root', true);
    expect($roots)->toHaveCount(1)
        ->and($roots->first()->file)->toBe('a.php');
});

it('serves depth-controlled downstream and chain meta on /errors (DX-9)', function () {
    asUser();
    $project = runImpactChainScan();

    // Default depth 1: direct dependents only.
    $default = $this->getJson("/api/v1/projects/{$project->id}/errors");
    $default->assertOk();
    $rootRow = collect($default->json('data'))->firstWhere('file', 'a.php');
    expect($rootRow['downstream'])->toBe(['b.php'])
        ->and($default->json('meta.depth'))->toBe(1);

    // depth=3: transitive impact.
    $deep = $this->getJson("/api/v1/projects/{$project->id}/errors?depth=3");
    $deep->assertOk();
    $deepRow = collect($deep->json('data'))->firstWhere('file', 'a.php');
    expect($deepRow['downstream'])->toBe(['b.php', 'c.php', 'd.php'])
        ->and($deep->json('meta.depth'))->toBe(3);

    // Chain meta groups all 4 error ids under one chain, root identified.
    $chains = $deep->json('meta.chains');
    expect($chains)->toHaveCount(1)
        ->and($chains[0]['errorIds'])->toHaveCount(4)
        ->and($chains[0]['rootErrorIds'])->toHaveCount(1);

    // Out-of-range depth is rejected by validation.
    $this->getJson("/api/v1/projects/{$project->id}/errors?depth=9")->assertStatus(422);
});
