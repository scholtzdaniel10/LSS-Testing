<?php

namespace App\Http\Controllers\Api\V1;

use App\Models\Project;
use App\Support\Cache\ProjectReadCache;
use Illuminate\Http\JsonResponse;

/**
 * Phase 3: one blob for Health cold start (project + health + usage + analyser meta).
 */
class BootstrapController extends Controller
{
    public function show(Project $project): JsonResponse
    {
        $payload = ProjectReadCache::remember("bootstrap:{$project->id}", function () use ($project): array {
            $project->loadCount('files');
            $health = $project->healthSnapshots()->orderByDesc('taken_at')->first();
            $usage = $project->usageReport;
            $scan = $project->scans()->orderByDesc('created_at')->first();

            return [
                'project' => [
                    'id' => $project->id,
                    'name' => $project->name,
                    'sourceType' => $project->source_type ?? 'import',
                    'localSourcePath' => $project->local_source_path,
                    'sandboxPath' => $project->sandbox_path,
                    'sandboxSizeBytes' => $project->sandbox_size_bytes,
                    'lastImportedAt' => $project->last_imported_at?->toIso8601String(),
                    'createdAt' => $project->created_at?->toIso8601String(),
                    'updatedAt' => $project->updated_at?->toIso8601String(),
                    'fileCount' => $project->files_count ?? $project->files()->count(),
                ],
                'health' => $health?->snapshot,
                'usage' => $usage?->report,
                'analysers' => $scan?->analyser_status ?? [],
            ];
        });

        return $this->respond($payload);
    }
}
