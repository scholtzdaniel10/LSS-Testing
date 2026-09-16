<?php

namespace App\Jobs;

use App\Jobs\Concerns\WarmsProjectReadCaches;
use App\Models\DiagnosticError;
use App\Models\JobStatus;
use App\Models\Project;
use App\Services\Diagnostics\AnalysisRunner;
use App\Support\Cache\ProjectReadCache;
use App\Support\Sandbox\ProjectWorkspace;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Str;
use Throwable;

/**
 * Progressive deepen: remaining PHPStan dirs after first-pass Diagnose.
 * Off the link→analyze critical path — first-pass Diagnose already marks findings usable.
 */
class DiagnoseDeepen implements ShouldQueue
{
    use Queueable;
    use WarmsProjectReadCaches;

    public int $timeout = 660;

    /**
     * @param  list<string>  $dirPaths  Relative dirs deferred from first pass
     */
    public function __construct(
        public readonly string $projectId,
        public readonly string $jobStatusId,
        public readonly array $dirPaths,
    ) {}

    public function handle(ProjectWorkspace $workspace, AnalysisRunner $runner): void
    {
        @set_time_limit(600);

        $status = JobStatus::query()->findOrFail($this->jobStatusId);
        if ($this->dirPaths === []) {
            $status->markDone('Nothing to deepen');

            return;
        }

        $status->markRunning(10);
        $project = Project::query()->findOrFail($this->projectId);
        $sandbox = $workspace->root($project);

        $result = $runner->run(
            $project,
            $sandbox,
            function (int $accepted, int $rejected, string $label, int $shardIndex, int $shardTotal) use ($status): void {
                $pct = 10 + (int) floor(80 * ($shardIndex / max(1, $shardTotal)));
                $status->update([
                    'status' => JobStatus::STATUS_RUNNING,
                    'progress' => min(90, $pct),
                    'message' => "Deepen {$shardIndex}/{$shardTotal}: {$label} ({$accepted} findings)",
                ]);
            },
            $this->dirPaths,
        );

        $this->mergePriorFindings($result['scan']->id, $project->id, $this->dirPaths);

        $status->markRunning(92);
        $edges = $project->graphSnapshots()->orderByDesc('scanned_at')->value('edges') ?? [];
        $runner->applyImpactAndChains($result['scan'], is_array($edges) ? $edges : []);

        ProjectReadCache::forgetProject($project->id);
        $this->warmReadCaches($project);

        $status->markDone(sprintf(
            'Deepen done · %d accepted, %d rejected',
            $result['accepted'],
            $result['rejected'],
        ));
    }

    public function failed(Throwable $e): void
    {
        JobStatus::query()->find($this->jobStatusId)?->markFailed($e->getMessage());
    }

    /**
     * @param  list<string>  $deepenedDirs
     */
    private function mergePriorFindings(string $newScanId, string $projectId, array $deepenedDirs): void
    {
        $prior = Project::query()->find($projectId)
            ?->scans()
            ->where('status', 'done')
            ->where('id', '!=', $newScanId)
            ->orderByDesc('created_at')
            ->first();

        if ($prior === null) {
            return;
        }

        $prefixes = array_map(
            static fn (string $d): string => rtrim(str_replace('\\', '/', $d), '/').'/',
            $deepenedDirs,
        );
        $now = now();
        $rows = [];

        foreach ($prior->errors()->cursor() as $error) {
            $file = str_replace('\\', '/', (string) $error->file);
            $inDeepened = false;
            foreach ($prefixes as $prefix) {
                if (str_starts_with($file, $prefix) || $file === rtrim($prefix, '/')) {
                    $inDeepened = true;
                    break;
                }
            }
            if ($inDeepened) {
                continue;
            }
            $rows[] = [
                'id' => (string) Str::uuid(),
                'scan_id' => $newScanId,
                'source' => $error->source,
                'rule_id' => $error->rule_id,
                'kind' => $error->kind,
                'severity' => $error->severity,
                'file' => $error->file,
                'range' => json_encode($error->range, JSON_THROW_ON_ERROR),
                'message' => $error->message,
                'explanation' => $error->explanation,
                'upstream' => json_encode($error->upstream ?? [], JSON_THROW_ON_ERROR),
                'downstream' => json_encode($error->downstream ?? [], JSON_THROW_ON_ERROR),
                'chain_id' => $error->chain_id,
                'is_root' => (bool) $error->is_root,
                'created_at' => $now,
                'updated_at' => $now,
            ];
            if (count($rows) >= 200) {
                DiagnosticError::query()->insert($rows);
                $rows = [];
            }
        }
        if ($rows !== []) {
            DiagnosticError::query()->insert($rows);
        }
    }
}
