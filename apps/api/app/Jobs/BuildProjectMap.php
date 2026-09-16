<?php

namespace App\Jobs;

use App\Jobs\Concerns\WarmsProjectReadCaches;
use App\Models\JobStatus;
use App\Models\Project;
use App\Services\Graph\DependencyGraphBuilder;
use App\Services\Graph\IncrementalGraphBuilder;
use App\Services\Import\UsageReportBuilder;
use App\Support\Cache\ProjectReadCache;
use App\Support\Sandbox\ProjectWorkspace;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Throwable;

/**
 * Phase A: usage + dependency graph → Map-ready. Does not run Diagnose tools.
 */
class BuildProjectMap implements ShouldQueue
{
    use Queueable;
    use WarmsProjectReadCaches;

    public int $timeout = 300;

    public function __construct(
        public readonly string $projectId,
        public readonly string $jobStatusId,
    ) {}

    public function handle(
        ProjectWorkspace $workspace,
        UsageReportBuilder $usage,
        DependencyGraphBuilder $graph,
        IncrementalGraphBuilder $incrementalGraph,
    ): void {
        @set_time_limit(300);

        $status = JobStatus::query()->findOrFail($this->jobStatusId);
        $status->markRunning(10);

        $project = Project::query()->findOrFail($this->projectId);
        $sandbox = $workspace->root($project);

        $status->markRunning(25);
        $this->ensureUsage($project, $sandbox, $usage);

        $status->markRunning(45);
        $maxGraph = max(100, (int) config('speed.graph_first_pass_max_files', 1500));
        $paths = $project->files()
            ->whereIn('lang', $graph->parseableLangs())
            ->orderBy('path')
            ->limit($maxGraph)
            ->pluck('path')
            ->all();

        $edges = $incrementalGraph->buildIndexed($project->id, $sandbox, $paths);
        $project->graphSnapshots()->create([
            'scanned_at' => now(),
            'edges' => $edges,
        ]);
        ProjectReadCache::forgetGraph($project->id);

        $status->markRunning(90);
        ProjectReadCache::forgetProject($project->id);
        $this->warmReadCaches($project);

        $status->markDone(sprintf('Map ready · %d edges', count($edges)));
    }

    public function failed(Throwable $e): void
    {
        JobStatus::query()->find($this->jobStatusId)?->markFailed($e->getMessage());
    }

    private function ensureUsage(Project $project, string $sandbox, UsageReportBuilder $usage): void
    {
        if (config('speed.skip_stale_usage_rebuild', true)) {
            $existing = $project->usageReport;
            if ($existing !== null
                && $project->last_imported_at !== null
                && $existing->updated_at !== null
                && $existing->updated_at->gte($project->last_imported_at)) {
                return;
            }
        }

        $report = $usage->build($sandbox, $project);
        $usage->persist($project, $report);
        ProjectReadCache::forgetUsage($project->id);
    }
}
