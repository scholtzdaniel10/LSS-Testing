<?php

namespace App\Jobs;

use App\Models\JobStatus;
use App\Models\Project;
use App\Services\Diagnostics\AnalysisRunner;
use App\Services\Graph\DependencyGraphBuilder;
use App\Services\Import\UsageReportBuilder;
use App\Support\Sandbox\PathJail;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
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
        PathJail $jail,
        UsageReportBuilder $usage,
        DependencyGraphBuilder $graph,
        AnalysisRunner $runner,
    ): void {
        $status = JobStatus::query()->findOrFail($this->jobStatusId);
        $status->markRunning(10);

        $project = Project::query()->findOrFail($this->projectId);
        if ($project->sandbox_path === null || $project->sandbox_path === '') {
            throw new \RuntimeException('Project has no sandbox; import first.');
        }

        $sandbox = $jail->assertInsideProject($this->projectId, $project->sandbox_path);

        $status->markRunning(25);
        $report = $usage->build($sandbox);
        $usage->persist($project, $report);

        $status->markRunning(45);
        $edges = $graph->build($sandbox);
        $project->graphSnapshots()->create([
            'scanned_at' => now(),
            'edges' => $edges,
        ]);

        $status->markRunning(70);
        $result = $runner->run($project, $sandbox);

        $status->markDone(sprintf(
            'Scan %s: %d findings (%d rejected by evidence gate)',
            $result['scan']->id,
            $result['accepted'],
            $result['rejected'],
        ));
    }

    public function failed(Throwable $exception): void
    {
        JobStatus::query()->find($this->jobStatusId)?->markFailed($exception->getMessage());
    }
}
