<?php

namespace App\Jobs;

use App\Models\JobStatus;
use App\Models\Project;
use App\Models\ProjectFile;
use App\Services\Import\LocalDirectoryScanner;
use App\Services\Import\UsageReportBuilder;
use App\Support\Cache\ProjectReadCache;
use App\Support\Jobs\DispatchAnalyzeChain;
use App\Support\Sandbox\ProjectWorkspace;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Throwable;

/**
 * Link an on-disk folder as the project source (Obsidian-style) — no zip upload.
 * Indexes files then queues analyze → snapshot (does not block on PHPStan).
 */
class LinkLocalProject implements ShouldQueue
{
    use Queueable;

    public int $timeout = 600;

    public function __construct(
        public readonly string $projectId,
        public readonly string $jobStatusId,
        public readonly string $localPath,
        public readonly ?string $projectName = null,
    ) {}

    public function handle(
        ProjectWorkspace $workspace,
        LocalDirectoryScanner $scanner,
        UsageReportBuilder $usage,
    ): void {
        @set_time_limit(600);

        $status = JobStatus::query()->findOrFail($this->jobStatusId);
        $status->markRunning(5);

        $project = Project::query()->findOrFail($this->projectId);
        $root = $workspace->assertLocalRoot($this->localPath);

        $status->markRunning(20);
        $result = $scanner->scan($root);

        DB::transaction(function () use ($project, $result, $root, $usage): void {
            $project->files()->delete();
            $rows = [];
            foreach ($result['files'] as $file) {
                $rows[] = [
                    'id' => (string) Str::uuid(),
                    'project_id' => $project->id,
                    'path' => $file['path'],
                    'size' => $file['size'],
                    'lang' => $file['lang'],
                    'created_at' => now(),
                    'updated_at' => now(),
                ];
                if (count($rows) >= 500) {
                    ProjectFile::query()->insert($rows);
                    $rows = [];
                }
            }
            if ($rows !== []) {
                ProjectFile::query()->insert($rows);
            }

            $report = $usage->build($root);
            $usage->persist($project, $report);

            $project->update([
                'name' => $this->projectName ?? $project->name,
                'source_type' => 'local',
                'local_source_path' => $root,
                'sandbox_path' => $root,
                'sandbox_size_bytes' => null,
                'last_imported_at' => now(),
            ]);
        });

        $status->markRunning(85);
        ProjectReadCache::forgetProject($this->projectId);

        $followOn = DispatchAnalyzeChain::dispatch(
            $this->projectId,
            'Post-link dependency scan',
            'Post-link health snapshot',
        );

        $status->markDone(
            'Linked local folder · '.count($result['files']).' files (skipped '.$result['skipped'].') · analyze queued',
            $followOn,
        );
    }

    public function failed(Throwable $exception): void
    {
        JobStatus::query()->find($this->jobStatusId)?->markFailed($exception->getMessage());
    }
}
