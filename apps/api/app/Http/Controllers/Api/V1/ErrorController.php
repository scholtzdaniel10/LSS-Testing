<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Requests\ListErrorsRequest;
use App\Models\DiagnosticError;
use App\Models\Project;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;

class ErrorController extends Controller
{
    /**
     * GET /projects/{project}/errors?severity=&kind=&file= — findings from the
     * latest scan, keyset-paginated (vault note 11: never OFFSET on errors).
     */
    public function index(ListErrorsRequest $request, Project $project): JsonResponse
    {
        $scan = $project->scans()->orderByDesc('created_at')->first();

        if ($scan === null) {
            return $this->respond([], [
                'reason' => 'not-scanned-yet',
                'analysers' => [],
            ]);
        }

        $filters = $request->validated();

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
                'upstream' => $error->upstream,
                'downstream' => $error->downstream,
            ]);

        return ApiResponse::cursorPaginated($paginator, [
            'scanId' => $scan->id,
            'analysers' => $scan->analyser_status ?? [],
        ]);
    }
}
