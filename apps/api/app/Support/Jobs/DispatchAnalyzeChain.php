<?php

namespace App\Support\Jobs;

use App\Jobs\AnalyzeProject;
use App\Jobs\BuildHealthSnapshot;
use App\Models\JobStatus;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\DB;

/**
 * Queue analyze → health snapshot as a Bus chain and return pollable job ids.
 */
final class DispatchAnalyzeChain
{
    /**
     * @return array{analyzeJobId: string, snapshotJobId: string}
     */
    public static function dispatch(
        string $projectId,
        ?string $analyzeMessage = null,
        ?string $snapshotMessage = null,
    ): array {
        [$analyze, $snapshot] = DB::transaction(function () use ($projectId, $analyzeMessage, $snapshotMessage): array {
            $analyze = JobStatus::query()->create([
                'type' => 'analyze',
                'project_id' => $projectId,
                'status' => JobStatus::STATUS_QUEUED,
                'message' => $analyzeMessage,
            ]);
            $snapshot = JobStatus::query()->create([
                'type' => 'build-health-snapshot',
                'project_id' => $projectId,
                'status' => JobStatus::STATUS_QUEUED,
                'message' => $snapshotMessage,
            ]);

            return [$analyze, $snapshot];
        });

        Bus::chain([
            new AnalyzeProject($projectId, $analyze->id),
            new BuildHealthSnapshot($projectId, $snapshot->id),
        ])->dispatch();

        return [
            'analyzeJobId' => $analyze->id,
            'snapshotJobId' => $snapshot->id,
        ];
    }
}
