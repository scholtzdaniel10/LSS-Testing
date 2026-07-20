<?php

namespace App\Jobs;

use App\Models\JobStatus;
use App\Models\Project;
use App\Models\ProjectFile;
use App\Services\Import\UsageReportBuilder;
use App\Services\Import\ZipImporter;
use App\Support\Sandbox\PathJail;
use App\Jobs\AnalyzeProject;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * IG-19 / IG-1: extract uploaded zip into path-jailed sandbox, replace
 * project_files, persist C4 usage report. Never executes imported code.
 */
class ImportProjectArchive implements ShouldQueue
{
    use Queueable;

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
                    'id' => (string) \Illuminate\Support\Str::uuid(),
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
                'last_imported_at' => now(),
            ]);
        });

        $status->markRunning(85);

        $analyzeStatus = JobStatus::query()->create([
            'type' => 'analyze',
            'project_id' => $project->id,
            'status' => JobStatus::STATUS_QUEUED,
            'message' => 'Post-import dependency scan',
        ]);
        AnalyzeProject::dispatchSync($this->projectId, $analyzeStatus->id);

        @unlink($this->zipPath);
        $status->markDone(
            'Imported '.count($result['files']).' files (skipped '.$result['skipped'].') · graph ready',
        );
    }

    public function failed(Throwable $exception): void
    {
        @unlink($this->zipPath);
        JobStatus::query()->find($this->jobStatusId)?->markFailed($exception->getMessage());
    }
}
