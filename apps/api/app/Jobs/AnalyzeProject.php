<?php

namespace App\Jobs;

use App\Models\DiagnosticError;
use App\Models\JobStatus;
use App\Models\Project;
use App\Services\Diagnostics\AnalysisRunner;
use App\Services\Graph\DependencyGraphBuilder;
use App\Services\Graph\IncrementalGraphBuilder;
use App\Services\Import\UsageReportBuilder;
use App\Support\Cache\ProjectReadCache;
use App\Support\Contracts\ContractDocuments;
use App\Support\Sandbox\ProjectWorkspace;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Str;
use Throwable;

/**
 * DX-1/3: rebuild usage + graph, run analysers, persist scan/errors.
 */
class AnalyzeProject implements ShouldQueue
{
    use Queueable;

    /** PHPStan may run up to 600s; leave headroom for the worker. */
    public int $timeout = 660;

    public function __construct(
        public readonly string $projectId,
        public readonly string $jobStatusId,
    ) {}

    public function handle(
        ProjectWorkspace $workspace,
        UsageReportBuilder $usage,
        DependencyGraphBuilder $graph,
        AnalysisRunner $runner,
        IncrementalGraphBuilder $incrementalGraph,
    ): void {
        @set_time_limit(600);

        $status = JobStatus::query()->findOrFail($this->jobStatusId);
        $status->markRunning(10);

        $project = Project::query()->findOrFail($this->projectId);
        $sandbox = $workspace->root($project);

        $status->markRunning(25);
        $this->ensureUsage($project, $sandbox, $usage);

        $status->markRunning(45);
        $paths = $project->files()
            ->whereIn('lang', $graph->parseableLangs())
            ->pluck('path')
            ->all();

        $edges = ContractDocuments::edges($incrementalGraph->buildIndexed($project->id, $sandbox, $paths));
        $project->graphSnapshots()->create([
            'scanned_at' => now(),
            'edges' => $edges,
        ]);
        ProjectReadCache::forgetGraph($project->id);

        $status->markRunning(55);
        $isRescan = $project->scans()->where('status', 'done')->exists();
        $changedPhp = $this->changedPhpPaths($project, $incrementalGraph);

        if ($isRescan && config('speed.incremental_graph', true) && $changedPhp === []) {
            $status->markDone('No PHP files changed — reused prior findings');
            ProjectReadCache::forgetProject($project->id);
            $this->warmReadCaches($project);

            return;
        }

        $phpstanPaths = ($isRescan && $this->shouldIncrementalPhpStan($changedPhp)) ? $changedPhp : null;

        $result = $runner->run(
            $project,
            $sandbox,
            function (int $accepted, int $rejected, string $label, int $shardIndex, int $shardTotal) use ($status): void {
                $pct = 55 + (int) floor(30 * ($shardIndex / max(1, $shardTotal)));
                $status->update([
                    'status' => JobStatus::STATUS_RUNNING,
                    'progress' => min(85, $pct),
                    'message' => "phpstan {$shardIndex}/{$shardTotal}: {$label} ({$accepted} findings)",
                ]);
            },
            $phpstanPaths,
        );

        if ($phpstanPaths !== null && $phpstanPaths !== []) {
            $this->replaceErrorsForPaths($result['scan']->id, $project->id, $phpstanPaths);
        }

        $status->markRunning(85);
        $runner->applyImpactAndChains($result['scan'], $edges);

        ProjectReadCache::forgetProject($project->id);
        $this->warmReadCaches($project);

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
        // First scan / huge change set → full sharded pass.
        if ($changedPhp === []) {
            return false;
        }
        if (count($changedPhp) > 80) {
            return false;
        }

        return true;
    }

    /**
     * Keep findings for untouched files from the previous done scan; new scan only holds changed-file findings.
     * Merge by copying untouched prior errors into the new scan.
     *
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

    private function warmReadCaches(Project $project): void
    {
        $project->loadCount('files');
        $snapshot = $project->graphSnapshots()->orderByDesc('scanned_at')->first();
        if ($snapshot !== null) {
            ProjectReadCache::put("graph:{$project->id}", [
                'projectId' => $project->id,
                'scannedAt' => $snapshot->scanned_at?->toIso8601String(),
                'edges' => $snapshot->edges,
            ]);
        }

        $usage = $project->usageReport;
        if ($usage !== null) {
            ProjectReadCache::put("usage:{$project->id}", [
                'projectId' => $project->id,
                'report' => $usage->report,
                'createdAt' => $usage->created_at?->toIso8601String(),
            ]);
        }

        $tree = $project->files()->orderBy('path')->get(['path', 'size', 'lang'])
            ->map(fn ($f) => ['path' => $f->path, 'size' => $f->size, 'lang' => $f->lang])
            ->all();
        ProjectReadCache::put("tree:{$project->id}", $tree);

        $health = $project->healthSnapshots()->orderByDesc('taken_at')->first();
        if ($health !== null) {
            ProjectReadCache::put("health:{$project->id}:latest", $health->snapshot);
        }

        ProjectReadCache::put("bootstrap:{$project->id}", [
            'project' => [
                'id' => $project->id,
                'name' => $project->name,
                'sourceType' => $project->source_type ?? 'import',
                'localSourcePath' => $project->local_source_path,
                'sandboxPath' => $project->sandbox_path,
                'sandboxSizeBytes' => $project->sandbox_size_bytes,
                'lastImportedAt' => $project->last_imported_at?->toIso8601String(),
                'fileCount' => $project->files_count ?? $project->files()->count(),
            ],
            'health' => $health?->snapshot,
            'usage' => $usage?->report,
            'analysers' => $project->scans()->orderByDesc('created_at')->value('analyser_status') ?? [],
        ]);
    }
}
