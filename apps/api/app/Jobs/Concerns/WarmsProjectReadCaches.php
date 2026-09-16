<?php

namespace App\Jobs\Concerns;

use App\Models\Project;
use App\Support\Cache\ProjectReadCache;

trait WarmsProjectReadCaches
{
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
