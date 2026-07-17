<?php

namespace App\Http\Controllers\Api\V1;

use App\Models\HealthSnapshot;
use App\Models\Project;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

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

        return $this->respond($snapshot->snapshot);
    }

    public function history(Request $request, Project $project): JsonResponse
    {
        $query = HealthSnapshot::query()
            ->where('project_id', $project->id)
            ->orderByDesc('taken_at');

        if ($request->filled('from')) {
            $query->where('taken_at', '>=', Carbon::parse((string) $request->query('from')));
        }

        if ($request->filled('to')) {
            $query->where('taken_at', '<=', Carbon::parse((string) $request->query('to')));
        }

        $perPage = min(max((int) $request->integer('per_page', 25), 1), 100);

        return $this->respondPaginated(
            $query->paginate($perPage)->through(
                fn (HealthSnapshot $snapshot): array => $snapshot->snapshot,
            ),
        );
    }
}
