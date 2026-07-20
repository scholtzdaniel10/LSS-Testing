<?php

namespace App\Http\Controllers\Api\V1;

use App\Jobs\BuildHealthSnapshot;
use App\Models\JobStatus;
use App\Models\Project;
use Illuminate\Http\JsonResponse;

class SnapshotController extends Controller
{
    /**
     * POST /projects/{project}/snapshot — queue a health snapshot build.
     * Returns 202 + the job-status id to poll (PLT-7 pattern).
     */
    public function store(Project $project): JsonResponse
    {
        $status = JobStatus::query()->create([
            'type' => 'build-health-snapshot',
            'project_id' => $project->id,
            'status' => JobStatus::STATUS_QUEUED,
        ]);

        BuildHealthSnapshot::dispatch($project->id, $status->id);

        return $this->respond([
            'jobId' => $status->id,
            'status' => $status->status,
        ], status: 202);
    }
}
