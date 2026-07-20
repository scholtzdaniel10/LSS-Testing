<?php

namespace App\Http\Controllers\Api\V1;

use App\Jobs\AnalyzeProject;
use App\Jobs\BuildHealthSnapshot;
use App\Models\JobStatus;
use App\Models\Project;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Bus;

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
     * UI-4: chain analyze → snapshot so the health screen updates after findings land.
     */
    public function rescan(Project $project): JsonResponse
    {
        if ($project->sandbox_path === null || $project->sandbox_path === '') {
            return $this->respond(
                ['message' => 'Import a program before running Re-scan.'],
                status: 422,
            );
        }

        $analyze = JobStatus::query()->create([
            'type' => 'analyze',
            'project_id' => $project->id,
            'status' => JobStatus::STATUS_QUEUED,
        ]);
        $snapshot = JobStatus::query()->create([
            'type' => 'build-health-snapshot',
            'project_id' => $project->id,
            'status' => JobStatus::STATUS_QUEUED,
        ]);

        $chain = Bus::chain([
            new AnalyzeProject($project->id, $analyze->id),
            new BuildHealthSnapshot($project->id, $snapshot->id),
        ]);

        try {
            if (config('queue.default') === 'sync') {
                $chain->dispatchSync();
            } else {
                $chain->dispatch();
            }
        } catch (\Throwable $e) {
            $analyze->refresh();
            $snapshot->refresh();
            if ($analyze->status !== JobStatus::STATUS_FAILED) {
                $analyze->markFailed($e->getMessage());
            }
            if ($snapshot->status !== JobStatus::STATUS_FAILED) {
                $snapshot->markFailed($e->getMessage());
            }

            return $this->respond([
                'analyzeJobId' => $analyze->id,
                'snapshotJobId' => $snapshot->id,
                'message' => $e->getMessage(),
            ], status: 500);
        }

        return $this->respond([
            'analyzeJobId' => $analyze->id,
            'snapshotJobId' => $snapshot->id,
        ], status: 202);
    }
}
