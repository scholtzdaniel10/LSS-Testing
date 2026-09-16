<?php

namespace App\Support\Jobs;

use App\Jobs\BuildHealthSnapshot;
use App\Jobs\BuildProjectMap;
use App\Jobs\DiagnoseProject;
use App\Models\JobStatus;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\DB;

/**
 * Queue map → diagnose → (optional) health snapshot; return pollable job ids.
 */
final class DispatchAnalyzeChain
{
    /**
     * @return array{mapJobId: string, diagnoseJobId: string, analyzeJobId: string, snapshotJobId?: string}
     */
    public static function dispatch(
        string $projectId,
        ?string $mapMessage = null,
        ?string $diagnoseMessage = null,
        ?string $snapshotMessage = null,
        bool $withSnapshot = true,
    ): array {
        $created = DB::transaction(function () use ($projectId, $mapMessage, $diagnoseMessage, $snapshotMessage, $withSnapshot): array {
            $map = JobStatus::query()->create([
                'type' => 'build-map',
                'project_id' => $projectId,
                'status' => JobStatus::STATUS_QUEUED,
                'message' => $mapMessage ?? 'Build Explore Map',
            ]);
            $diagnose = JobStatus::query()->create([
                'type' => 'diagnose',
                'project_id' => $projectId,
                'status' => JobStatus::STATUS_QUEUED,
                'message' => $diagnoseMessage ?? 'Run Diagnose tools',
            ]);
            $snapshot = null;
            if ($withSnapshot) {
                $snapshot = JobStatus::query()->create([
                    'type' => 'build-health-snapshot',
                    'project_id' => $projectId,
                    'status' => JobStatus::STATUS_QUEUED,
                    'message' => $snapshotMessage,
                ]);
            }

            return compact('map', 'diagnose', 'snapshot');
        });

        $jobs = [
            new BuildProjectMap($projectId, $created['map']->id),
            new DiagnoseProject($projectId, $created['diagnose']->id),
        ];
        if ($created['snapshot'] !== null) {
            $jobs[] = new BuildHealthSnapshot($projectId, $created['snapshot']->id);
        }

        Bus::chain($jobs)->dispatch();

        // analyzeJobId aliases diagnose for older UI/clients that poll one "analyze" id.
        $out = [
            'mapJobId' => $created['map']->id,
            'diagnoseJobId' => $created['diagnose']->id,
            'analyzeJobId' => $created['diagnose']->id,
        ];
        if ($created['snapshot'] !== null) {
            $out['snapshotJobId'] = $created['snapshot']->id;
        }

        return $out;
    }
}
