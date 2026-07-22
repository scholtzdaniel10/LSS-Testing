<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Requests\ListErrorsRequest;
use App\Models\DiagnosticError;
use App\Models\Project;
use App\Services\Diagnostics\ImpactResolver;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;

class ErrorController extends Controller
{
    /**
     * GET /projects/{project}/errors?severity=&kind=&file=&depth= — findings
     * from the latest scan, keyset-paginated (vault note 11: never OFFSET on
     * errors).
     *
     * DX-9: `depth` (1–3, default 1) controls the downstream view — default is
     * direct dependents only; transitive impact sits behind the parameter.
     * Recomputed per request from the latest graph snapshot; the persisted
     * values (full cap) are the fallback when no snapshot exists.
     */
    public function index(ListErrorsRequest $request, Project $project): JsonResponse
    {
        /** @var \App\Models\Scan|null $scan */
        $scan = $project->scans()->orderByDesc('created_at')->first();

        if ($scan === null) {
            return $this->respond([], [
                'reason' => 'not-scanned-yet',
                'analysers' => [],
            ]);
        }

        $filters = $request->validated();
        $depth = (int) ($filters['depth'] ?? 1);

        $snapshot = $project->graphSnapshots()->orderByDesc('scanned_at')->first();
        $resolver = $snapshot !== null && is_array($snapshot->edges)
            ? new ImpactResolver($snapshot->edges)
            : null;

        $query = $scan->errors()->orderBy('id');
        foreach (['severity', 'kind', 'file'] as $column) {
            if (isset($filters[$column])) {
                $query->where($column, $filters[$column]);
            }
        }

        $paginator = $query
            ->cursorPaginate($filters['per_page'] ?? 50)
            ->through(fn (DiagnosticError $error): array => [
                'id' => $error->id,
                'source' => $error->source,
                'ruleId' => $error->rule_id,
                'kind' => $error->kind,
                'severity' => $error->severity,
                'file' => $error->file,
                'range' => $error->range,
                'message' => $error->message,
                'explanation' => $error->explanation,
                'upstream' => $resolver !== null
                    ? $resolver->upstream($error->file)
                    : ($error->upstream ?? []),
                'downstream' => $resolver !== null
                    ? $resolver->downstream($error->file, $depth)
                    : ($error->downstream ?? []),
            ]);

        /** @var array<string, string> $analyserStatus */
        $analyserStatus = is_array($scan->analyser_status) ? $scan->analyser_status : [];

        return ApiResponse::cursorPaginated($paginator, [
            'scanId' => $scan->id,
            'analysers' => $analyserStatus,
            'depth' => $depth,
            // DX-8: chain groupings live in meta so error rows stay exactly
            // C5-shaped (additionalProperties: false).
            'chains' => $this->chains($scan->id),
        ]);
    }

    /**
     * Chain groupings for the scan: members + root error ids per chain.
     *
     * @return list<array{chainId: string, rootErrorIds: list<string>, errorIds: list<string>}>
     */
    private function chains(string $scanId): array
    {
        $rows = DiagnosticError::query()
            ->where('scan_id', $scanId)
            ->whereNotNull('chain_id')
            ->orderBy('id')
            ->get(['id', 'chain_id', 'is_root']);

        $chains = [];
        foreach ($rows as $row) {
            $chainId = (string) $row->chain_id;
            $chains[$chainId] ??= ['chainId' => $chainId, 'rootErrorIds' => [], 'errorIds' => []];
            $chains[$chainId]['errorIds'][] = $row->id;
            if ($row->is_root) {
                $chains[$chainId]['rootErrorIds'][] = $row->id;
            }
        }

        return array_values($chains);
    }
}
