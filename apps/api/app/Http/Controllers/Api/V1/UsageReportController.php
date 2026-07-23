<?php

namespace App\Http\Controllers\Api\V1;

use App\Models\Project;
use App\Support\Cache\ProjectReadCache;
use Illuminate\Http\JsonResponse;

class UsageReportController extends Controller
{
    /** GET /projects/{project}/usage-report — latest C4 uses/needs report. */
    public function show(Project $project): JsonResponse
    {
        $payload = ProjectReadCache::remember("usage:{$project->id}", function () use ($project): ?array {
            $report = $project->usageReport()->orderByDesc('created_at')->first();

            if ($report === null) {
                return null;
            }

            return [
                'projectId' => $project->id,
                'report' => $report->report,
                'createdAt' => $report->created_at?->toIso8601String(),
            ];
        });

        if ($payload === null) {
            return $this->respond(null, ['reason' => 'not-imported-yet']);
        }

        return $this->respond($payload);
    }
}
