<?php

namespace App\Jobs;

use App\Jobs\Concerns\WarmsProjectReadCaches;
use App\Models\DiagnosticError;
use App\Models\JobStatus;
use App\Models\Project;
use App\Services\Diagnostics\AnalysisRunner;
use App\Services\Graph\IncrementalGraphBuilder;
use App\Support\Cache\ProjectReadCache;
use App\Support\Sandbox\ProjectWorkspace;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Str;
use Throwable;

/**
 * Phase B: PHPStan/phpcs/phpmd/js/php_test → scan/errors/impact. Own JobStatus.
 */
class DiagnoseProject implements ShouldQueue
{
    use Queueable;
    use WarmsProjectReadCaches;

    /** PHPStan may run up to 600s; leave headroom for the worker. */
    public int $timeout = 660;

    public function __construct(
        public readonly string $projectId,
        public readonly string $jobStatusId,
    ) {}

    public function handle(
        ProjectWorkspace $workspace,
        AnalysisRunner $runner,
        IncrementalGraphBuilder $incrementalGraph,
    ): void {
        @set_time_limit(600);

        $status = JobStatus::query()->findOrFail($this->jobStatusId);
        $status->markRunning(5);

        $project = Project::query()->findOrFail($this->projectId);
        $sandbox = $workspace->root($project);

        $isRescan = $project->scans()->where('status', 'done')->exists();
        $changedPhp = $this->changedPhpPaths($project, $incrementalGraph);

        if ($isRescan && config('speed.incremental_graph', true) && $changedPhp === []) {
            $status->markDone('No PHP files changed — reused prior findings');
            ProjectReadCache::forgetProject($project->id);
            $this->warmReadCaches($project);

            return;
        }

        $phpstanPaths = ($isRescan && $this->shouldIncrementalPhpStan($changedPhp)) ? $changedPhp : null;

        $status->markRunning(10);
        $result = $runner->run(
            $project,
            $sandbox,
            function (int $accepted, int $rejected, string $label, int $shardIndex, int $shardTotal) use ($status): void {
                $pct = 10 + (int) floor(80 * ($shardIndex / max(1, $shardTotal)));
                $status->update([
                    'status' => JobStatus::STATUS_RUNNING,
                    'progress' => min(90, $pct),
                    'message' => "Diagnose {$shardIndex}/{$shardTotal}: {$label} ({$accepted} findings)",
                ]);
            },
            $phpstanPaths,
        );

        if ($phpstanPaths !== null && $phpstanPaths !== []) {
            $this->replaceErrorsForPaths($result['scan']->id, $project->id, $phpstanPaths);
        }

        $status->markRunning(92);
        $edges = $project->graphSnapshots()->orderByDesc('scanned_at')->value('edges') ?? [];
        $runner->applyImpactAndChains($result['scan'], is_array($edges) ? $edges : []);

        ProjectReadCache::forgetProject($project->id);
        $this->warmReadCaches($project);

        $analyserNote = '';
        if (($result['analysers']['phpstan'] ?? null) === 'missing_binary') {
            $analyserNote = ' · PHPStan missing on Maintain API (composer install in apps/api)';
        } elseif (($result['analysers']['phpstan'] ?? null) === 'clean') {
            $analyserNote = ' · PHPStan clean';
        }

        $deferred = $result['phpstanDeferred'] ?? [];
        if ($deferred !== []) {
            $dirs = [];
            foreach ($deferred as $shard) {
                foreach ($shard['paths'] ?? [] as $path) {
                    $dirs[] = $path;
                }
            }
            $dirs = array_values(array_unique($dirs));
            if ($dirs !== []) {
                // Under sync, dispatch would block the first-pass SLA; queue workers run deepen async.
                if (config('queue.default') === 'sync') {
                    $analyserNote .= ' · first-pass · deepen deferred ('.count($dirs).' paths; use async queue)';
                } else {
                    $deepen = JobStatus::query()->create([
                        'type' => 'diagnose-deepen',
                        'project_id' => $project->id,
                        'status' => JobStatus::STATUS_QUEUED,
                        'message' => 'Progressive deepen (remaining dirs)',
                    ]);
                    DiagnoseDeepen::dispatch($project->id, $deepen->id, $dirs);
                    $analyserNote .= ' · first-pass · deepen queued ('.count($dirs).' paths)';
                }
            }
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

    /**
     * @return list<string>
     */
    private function changedPhpPaths(Project $project, IncrementalGraphBuilder $incrementalGraph): array
    {
        $changed = $incrementalGraph->lastChangedPaths($project->id);

        return array_values(array_filter(
            $changed,
            static fn (string $p): bool => str_ends_with(strtolower($p), '.php'),
        ));
    }

    /**
     * @param  list<string>  $changedPhp
     */
    private function shouldIncrementalPhpStan(array $changedPhp): bool
    {
        if (! config('speed.incremental_graph', true)) {
            return false;
        }
        if ($changedPhp === []) {
            return false;
        }
        if (count($changedPhp) > 80) {
            return false;
        }

        return true;
    }

    /**
     * @param  list<string>  $changedPaths
     */
    private function replaceErrorsForPaths(string $newScanId, string $projectId, array $changedPaths): void
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

        $changedLookup = array_fill_keys($changedPaths, true);
        $now = now();
        $rows = [];

        foreach ($prior->errors()->cursor() as $error) {
            if (isset($changedLookup[$error->file])) {
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
