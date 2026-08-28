<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Requests\GraphOverviewRequest;
use App\Models\Project;
use App\Services\Graph\GraphAggregator;
use App\Support\Cache\ProjectReadCache;
use Illuminate\Http\JsonResponse;

class GraphAggregateController extends Controller
{
    /**
     * GET /projects/{project}/graph/overview — ranked folder-hub + file slice.
     * Existing GET /graph is unchanged.
     */
    public function overview(
        GraphOverviewRequest $request,
        Project $project,
        GraphAggregator $aggregator,
    ): JsonResponse {
        $limit = $request->fileCap();

        $cached = ProjectReadCache::rememberOverview(
            $project->id,
            $limit,
            function () use ($project, $limit, $aggregator): ?array {
                $snapshot = $project->graphSnapshots()->orderByDesc('scanned_at')->first();
                if ($snapshot === null) {
                    return null;
                }

                $files = $project->files()->orderBy('path')->pluck('path')->all();
                $errorCounts = $this->errorCounts($project);
                $edges = is_array($snapshot->edges) ? $snapshot->edges : [];
                $view = $aggregator->overview($edges, $files, $errorCounts, $limit);

                return [
                    'data' => [
                        'projectId' => $project->id,
                        'scannedAt' => $snapshot->scanned_at?->toIso8601String(),
                        'nodes' => $view['nodes'],
                        'links' => $view['links'],
                    ],
                    'meta' => [
                        'total' => $view['total'],
                        'returned' => $view['returned'],
                        'truncated' => $view['truncated'],
                        'cap' => $view['cap'],
                    ],
                ];
            },
        );

        if ($cached === null) {
            return $this->respond(null, ['reason' => 'no-graph-yet']);
        }

        return $this->respond($cached['data'], $cached['meta']);
    }

    /**
     * @return array<string, int>
     */
    private function errorCounts(Project $project): array
    {
        $scan = $project->scans()->orderByDesc('created_at')->first();
        if ($scan === null) {
            return [];
        }

        $counts = [];
        foreach ($scan->errors()->orderBy('id')->get(['file']) as $row) {
            $path = (string) $row->file;
            $counts[$path] = ($counts[$path] ?? 0) + 1;
        }

        return $counts;
    }
}
