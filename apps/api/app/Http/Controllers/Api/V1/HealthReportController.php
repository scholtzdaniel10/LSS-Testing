<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Requests\HealthReportHistoryRequest;
use App\Models\HealthSnapshot;
use App\Models\Project;
use App\Support\Cache\ProjectReadCache;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;

class HealthReportController extends Controller
{
    public function show(Project $project): JsonResponse
    {
        $snapshotDoc = ProjectReadCache::remember(
            "health:{$project->id}:latest",
            function () use ($project): ?array {
                $snapshot = HealthSnapshot::query()
                    ->where('project_id', $project->id)
                    ->orderByDesc('taken_at')
                    ->first();

                return $snapshot?->snapshot;
            },
        );

        if ($snapshotDoc === null) {
            return $this->respond(null, ['message' => 'No health snapshot recorded yet.']);
        }

        return $this->respond($snapshotDoc, ['formula' => config('health.formula')]);
    }

    public function history(HealthReportHistoryRequest $request, Project $project): JsonResponse
    {
        $filters = $request->validated();

        $query = HealthSnapshot::query()
            ->where('project_id', $project->id)
            ->orderByDesc('taken_at');

        if (! empty($filters['from'])) {
            $query->where('taken_at', '>=', Carbon::parse($filters['from']));
        }

        if (! empty($filters['to'])) {
            $query->where('taken_at', '<=', Carbon::parse($filters['to']));
        }

        $perPage = isset($filters['per_page'])
            ? (int) $filters['per_page']
            : 25;

        return $this->respondPaginated(
            $query->paginate($perPage)->through(
                fn (HealthSnapshot $snapshot): array => $snapshot->snapshot,
            ),
        );
    }
}
