<?php

namespace App\Http\Controllers\Api\V1;

use App\Models\JobStatus;
use Illuminate\Http\JsonResponse;

class JobStatusController extends Controller
{
    /** GET /jobs/{jobStatus} — the shared queued-job polling endpoint (PLT-7). */
    public function show(JobStatus $jobStatus): JsonResponse
    {
        return $this->respond([
            'id' => $jobStatus->id,
            'type' => $jobStatus->type,
            'projectId' => $jobStatus->project_id,
            'status' => $jobStatus->status,
            'progress' => $jobStatus->progress,
            'message' => $jobStatus->message,
            'result' => $jobStatus->result,
            'createdAt' => $jobStatus->created_at?->toIso8601String(),
            'updatedAt' => $jobStatus->updated_at?->toIso8601String(),
        ]);
    }
}
