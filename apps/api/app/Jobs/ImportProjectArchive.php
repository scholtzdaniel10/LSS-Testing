<?php

namespace App\Jobs;

use App\Models\JobStatus;
use App\Models\Project;
use App\Models\ProjectFile;
use App\Services\Import\UsageReportBuilder;
use App\Services\Import\ZipImporter;
use App\Support\Cache\ProjectReadCache;
use App\Support\Jobs\DispatchAnalyzeChain;
use App\Support\Sandbox\PathJail;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Throwable;

/**
 * IG-19 / IG-1: extract uploaded zip into path-jailed sandbox, replace
 * project_files, persist C4 usage report. Never executes imported code.
 * Indexes files then queues analyze → snapshot (does not block on PHPStan).
 */
class ImportProjectArchive implements ShouldQueue
{
    use Queueable;

    public int $timeout = 600;

    public function __construct(
        public readonly string $projectId,
        public readonly string $jobStatusId,
        public readonly string $zipPath,
        public readonly string $projectName,
    ) {}

    public function handle(
        ZipImporter $importer,
        UsageReportBuilder $usage,
        PathJail $jail,
    ): void {
        $status = JobStatus::query()->findOrFail($this->jobStatusId);
        $status->markRunning(5);

        $project = Project::query()->findOrFail($this->projectId);
        $result = $importer->import($this->projectId, $this->zipPath);

        $status->markRunning(60);

        DB::transaction(function () use ($project, $result, $jail, $usage): void {
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

            $sandbox = $jail->projectRoot($project->id);
            $report = $usage->build($sandbox);
            $usage->persist($project, $report);

            $project->update([
                'name' => $this->projectName,
                'sandbox_path' => $sandbox,
                'sandbox_size_bytes' => $this->directorySize($sandbox),
                'last_imported_at' => now(),
            ]);
        });

        $status->markRunning(85);
        ProjectReadCache::forgetProject($this->projectId);

        $followOn = DispatchAnalyzeChain::dispatch(
            $this->projectId,
            'Post-import dependency scan',
            'Post-import health snapshot',
        );

        @unlink($this->zipPath);
        $status->markDone(
            'Imported '.count($result['files']).' files (skipped '.$result['skipped'].') · analyze queued',
            $followOn,
        );
    }

    public function failed(Throwable $exception): void
    {
        @unlink($this->zipPath);
        JobStatus::query()->find($this->jobStatusId)?->markFailed($exception->getMessage());
    }

    private function directorySize(string $root): int
    {
        if (! is_dir($root)) {
            return 0;
        }
        $total = 0;
        $iterator = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($root, \FilesystemIterator::SKIP_DOTS),
        );
        foreach ($iterator as $file) {
            if ($file->isFile()) {
                $total += (int) $file->getSize();
            }
        }

        return $total;
    }
}
