<?php

namespace App\Jobs;

use App\Models\HealthSnapshot;
use App\Models\JobStatus;
use App\Models\Project;
use App\Services\HealthSnapshotBuilder;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Throwable;

/**
 * HD-2 / PLT-7: builds and persists a C2 health snapshot for a project,
 * reporting progress through the job_statuses row the controller created.
 * Retention: keeps the newest 365 snapshots per project (vault note 11).
 */
class BuildHealthSnapshot implements ShouldQueue
{
    use Queueable;

    private const KEEP_SNAPSHOTS = 365;

    public function __construct(
        public readonly string $projectId,
        public readonly string $jobStatusId,
    ) {}

    public function handle(HealthSnapshotBuilder $builder): void
    {
        $status = JobStatus::query()->findOrFail($this->jobStatusId);
        $status->markRunning();

        $project = Project::query()->findOrFail($this->projectId);
        $document = $builder->build($project);

        $snapshot = $project->healthSnapshots()->create([
            'taken_at' => now(),
            'snapshot' => $document,
        ]);

        $project->healthSnapshots()
            ->orderByDesc('taken_at')
            ->skip(self::KEEP_SNAPSHOTS)
            ->take(PHP_INT_MAX)
            ->pluck('id')
            ->each(fn (string $id) => HealthSnapshot::query()->whereKey($id)->delete());

        $status->markDone("Snapshot {$snapshot->id} created");
    }

    public function failed(Throwable $exception): void
    {
        JobStatus::query()->find($this->jobStatusId)?->markFailed($exception->getMessage());
    }
}
