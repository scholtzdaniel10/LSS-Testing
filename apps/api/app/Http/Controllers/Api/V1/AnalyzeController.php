<?php

namespace App\Http\Controllers\Api\V1;

use App\Models\JobStatus;
use App\Models\Project;
use App\Support\Jobs\DispatchAnalyzeChain;
use Illuminate\Http\JsonResponse;

class AnalyzeController extends Controller
{
    /**
     * Queue map → diagnose (usage/graph then analysers). Expensive throttle.
     */
    public function store(Project $project): JsonResponse
    {
        if ($project->sandbox_path === null || $project->sandbox_path === '') {
            return $this->respond(
                ['message' => 'Import a program before running analysis.'],
                status: 422,
            );
        }

        $ids = DispatchAnalyzeChain::dispatch(
            $project->id,
            'Manual map build',
            'Manual diagnose',
            withSnapshot: false,
        );

        return $this->respond([
            'jobId' => $ids['mapJobId'],
            'mapJobId' => $ids['mapJobId'],
            'diagnoseJobId' => $ids['diagnoseJobId'],
            'status' => JobStatus::STATUS_QUEUED,
        ], status: 202);
    }

    /**
     * UI-4: queue map → diagnose → snapshot so Health updates after findings land.
     * Returns 202 immediately; poll mapJobId (Map ready), then diagnoseJobId, then snapshotJobId.
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
