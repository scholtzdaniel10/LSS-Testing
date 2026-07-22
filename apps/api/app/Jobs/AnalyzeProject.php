<?php

namespace App\Jobs;

use App\Models\JobStatus;
use App\Models\Project;
use App\Services\Diagnostics\AnalysisRunner;
use App\Services\Diagnostics\ChainDetector;
use App\Services\Diagnostics\ImpactResolver;
use App\Services\Graph\DependencyGraphBuilder;
use App\Services\Import\UsageReportBuilder;
use App\Support\Sandbox\ProjectWorkspace;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Cache;
use Throwable;

/**
 * DX-1/3: rebuild usage + graph, run analysers, persist scan/errors.
 */
class AnalyzeProject implements ShouldQueue
{
    use Queueable;

    public function __construct(
        public readonly string $projectId,
        public readonly string $jobStatusId,
    ) {}

    public function handle(
        ProjectWorkspace $workspace,
        UsageReportBuilder $usage,
        DependencyGraphBuilder $graph,
        AnalysisRunner $runner,
    ): void {
        @set_time_limit(600);

        $status = JobStatus::query()->findOrFail($this->jobStatusId);
        $status->markRunning(10);

        $project = Project::query()->findOrFail($this->projectId);
        $sandbox = $workspace->root($project);

        $status->markRunning(25);
        $report = $usage->build($sandbox);
        $usage->persist($project, $report);

        $status->markRunning(45);
        $paths = $project->files()->pluck('path')->all();
        $edges = $graph->buildIndexed($sandbox, $paths);
        $project->graphSnapshots()->create([
            'scanned_at' => now(),
            'edges' => $edges,
        ]);
        Cache::forget("graph:{$project->id}");

        $status->markRunning(70);
        $result = $runner->run($project, $sandbox);

        // DX-7: join errors onto the edge list — upstream = possible causes,
        // downstream = blast radius. $edges is already in memory here.
        $status->markRunning(85);
        $resolver = new ImpactResolver($edges);
        $errors = $result['scan']->errors()->get();
        foreach ($errors as $error) {
            $error->update([
                'upstream' => $resolver->upstream($error->file),
                'downstream' => $resolver->downstream($error->file),
            ]);
        }

        // DX-8: link errors on a shared dependency path into chains.
        $chains = (new ChainDetector)->detect(
            $errors->map(fn ($error): array => ['id' => $error->id, 'file' => $error->file])->all(),
            $resolver,
        );
        foreach ($errors as $error) {
            $assignment = $chains[$error->id] ?? null;
            if ($assignment !== null && $assignment['chainId'] !== null) {
                $error->update([
                    'chain_id' => $assignment['chainId'],
                    'is_root' => $assignment['isRoot'],
                ]);
            }
        }

        $analyserNote = '';
        if (($result['analysers']['phpstan'] ?? null) === 'missing_binary') {
            $analyserNote = ' · PHPStan missing on Maintain API (composer install in apps/api)';
        } elseif (($result['analysers']['phpstan'] ?? null) === 'clean') {
            $analyserNote = ' · PHPStan clean';
        }

        $status->markDone(sprintf(
            '%d accepted, %d rejected%s',
            $result['accepted'],
            $result['rejected'],
            $analyserNote,
        ));
    }

    public function failed(Throwable $e): void
    {
        JobStatus::query()->find($this->jobStatusId)?->markFailed($e->getMessage());
    }
}
