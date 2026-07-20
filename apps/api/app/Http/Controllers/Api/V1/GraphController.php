<?php

namespace App\Http\Controllers\Api\V1;

use App\Models\Project;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Cache;

class GraphController extends Controller
{
    /**
     * GET /projects/{project}/graph — latest C3 graph snapshot. Redis (or the
     * local cache store) fronts the document; Postgres is the source of truth
     * (vault note 11, rule 5).
     */
    public function show(Project $project): JsonResponse
    {
        $payload = Cache::remember(
            "graph:{$project->id}",
            now()->addMinutes(10),
            function () use ($project): ?array {
                $snapshot = $project->graphSnapshots()->orderByDesc('scanned_at')->first();

                if ($snapshot === null) {
                    return null;
                }

                return [
                    'projectId' => $project->id,
                    'scannedAt' => $snapshot->scanned_at?->toIso8601String(),
                    'edges' => $snapshot->edges,
                ];
            },
        );

        if ($payload === null) {
            return $this->respond(null, ['reason' => 'no-graph-yet']);
        }

        return $this->respond($payload);
    }
}
