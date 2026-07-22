<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Requests\HealthReportHistoryRequest;
use App\Models\HealthSnapshot;
use App\Models\Project;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;

class HealthReportController extends Controller
{
    public function show(Project $project): JsonResponse
    {
        $snapshot = HealthSnapshot::query()
            ->where('project_id', $project->id)
            ->orderByDesc('taken_at')
            ->first();

        if ($snapshot === null) {
            return $this->respond(null, ['message' => 'No health snapshot recorded yet.']);
        }

        // HD-4: the dashboard must be able to show its work — the scoring
        // formula travels with every report.
        return $this->respond($snapshot->snapshot, ['formula' => config('health.formula')]);
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
