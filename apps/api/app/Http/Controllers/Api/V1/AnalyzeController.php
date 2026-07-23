<?php

namespace App\Http\Controllers\Api\V1;

use App\Jobs\AnalyzeProject;
use App\Models\JobStatus;
use App\Models\Project;
use App\Support\Jobs\DispatchAnalyzeChain;
use Illuminate\Http\JsonResponse;

class AnalyzeController extends Controller
{
    /**
     * DX-3: queue analysis (usage + graph + PHPStan). Expensive throttle.
     */
    public function store(Project $project): JsonResponse
    {
        if ($project->sandbox_path === null || $project->sandbox_path === '') {
            return $this->respond(
                ['message' => 'Import a program before running analysis.'],
                status: 422,
            );
        }

        $status = JobStatus::query()->create([
            'type' => 'analyze',
            'project_id' => $project->id,
            'status' => JobStatus::STATUS_QUEUED,
        ]);

        AnalyzeProject::dispatch($project->id, $status->id);

        return $this->respond([
            'jobId' => $status->id,
            'status' => $status->status,
        ], status: 202);
    }

    /**
     * UI-4: queue analyze → snapshot so the health screen updates after findings land.
     * Returns 202 immediately; poll analyzeJobId then snapshotJobId.
     */
    public function rescan(Project $project): JsonResponse
    {
        if ($project->sandbox_path === null || $project->sandbox_path === '') {
            return $this->respond(
                ['message' => 'Import a program before running Re-scan.'],
                status: 422,
            );
        }

        $ids = DispatchAnalyzeChain::dispatch($project->id);

        return $this->respond($ids, status: 202);
    }
}
