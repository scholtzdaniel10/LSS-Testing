<?php

namespace App\Http\Controllers\Api\V1;

use App\Models\JobStatus;
use App\Models\Project;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class JobStatusController extends Controller
{
    /** GET /jobs/{jobStatus} — the shared queued-job polling endpoint (PLT-7). */
    public function show(JobStatus $jobStatus): JsonResponse
    {
        return $this->respond($this->serialize($jobStatus));
    }

    /**
     * GET /projects/{project}/jobs/latest?type=diagnose — latest job of a type for UI polling.
     */
    public function latest(Project $project, Request $request): JsonResponse
    {
        $type = (string) $request->query('type', 'diagnose');
        if (! in_array($type, ['build-map', 'diagnose', 'diagnose-deepen', 'build-health-snapshot', 'analyze', 'import', 'link-local'], true)) {
            return $this->respond(['message' => 'Unknown job type.'], status: 422);
        }

        $job = JobStatus::query()
            ->where('project_id', $project->id)
            ->where('type', $type)
            ->orderByDesc('created_at')
            ->first();

        if ($job === null) {
            return $this->respond(null);
        }

        return $this->respond($this->serialize($job));
    }

    /**
     * @return array<string, mixed>
     */
    private function serialize(JobStatus $jobStatus): array
    {
        return [
            'id' => $jobStatus->id,
            'type' => $jobStatus->type,
            'projectId' => $jobStatus->project_id,
            'status' => $jobStatus->status,
            'progress' => $jobStatus->progress,
            'message' => $jobStatus->message,
            'result' => $jobStatus->result,
            'createdAt' => $jobStatus->created_at?->toIso8601String(),
            'updatedAt' => $jobStatus->updated_at?->toIso8601String(),
        ];
    }
}
