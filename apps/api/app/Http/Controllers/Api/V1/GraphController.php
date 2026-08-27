<?php

namespace App\Http\Controllers\Api\V1;

use App\Models\Project;
use App\Support\Cache\ProjectReadCache;
use App\Support\Contracts\ContractDocuments;
use Illuminate\Http\JsonResponse;

class GraphController extends Controller
{
    /**
     * GET /projects/{project}/graph — latest C3 graph snapshot. Cache fronts
     * the document; Postgres/SQLite is the source of truth.
     */
    public function show(Project $project): JsonResponse
    {
        $payload = ProjectReadCache::remember(
            "graph:{$project->id}",
            function () use ($project): ?array {
                $snapshot = $project->graphSnapshots()->orderByDesc('scanned_at')->first();

                if ($snapshot === null) {
                    return null;
                }

                return [
                    'projectId' => $project->id,
                    'scannedAt' => $snapshot->scanned_at?->toIso8601String(),
                    'edges' => array_values(array_map(
                        static fn (array $edge): array => ContractDocuments::edge($edge),
                        array_filter(
                            is_array($snapshot->edges) ? $snapshot->edges : [],
                            'is_array',
                        ),
                    )),
                ];
            },
        );

        if ($payload === null) {
            return $this->respond(null, ['reason' => 'no-graph-yet']);
        }

        return $this->respond($payload);
    }
}
