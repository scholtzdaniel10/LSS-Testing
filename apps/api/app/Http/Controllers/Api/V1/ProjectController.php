<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Requests\ImportProjectRequest;
use App\Http\Requests\StoreProjectRequest;
use App\Jobs\ImportProjectArchive;
use App\Models\JobStatus;
use App\Models\Project;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class ProjectController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $perPage = min(max((int) $request->integer('per_page', 25), 1), 100);

        return $this->respondPaginated(
            Project::query()
                ->orderBy('name')
                ->paginate($perPage)
                ->through(fn (Project $project): array => $this->serializeProject($project)),
        );
    }

    public function show(Project $project): JsonResponse
    {
        return $this->respond($this->serializeProject($project));
    }

    public function store(StoreProjectRequest $request): JsonResponse
    {
        $data = $request->validated();
        $project = Project::query()->create([
            'name' => $data['name'],
            'sandbox_path' => null,
            'last_imported_at' => null,
        ]);

        return $this->respond($this->serializeProject($project), status: 201);
    }

    /**
     * IG-19: upload filtered zip → queued import into path-jailed sandbox.
     * Passing resumeToken of a failed/queued job restarts cleanly (replace import).
     */
    public function import(ImportProjectRequest $request, Project $project): JsonResponse
    {
        $data = $request->validated();
        $file = $request->file('archive');
        $name = $data['name'] ?? $project->name;

        $stored = $file->storeAs(
            'imports',
            $project->id.'_'.Str::uuid()->toString().'.zip',
            'local',
        );
        $absolute = Storage::disk('local')->path($stored);

        $status = JobStatus::query()->create([
            'type' => 'import',
            'project_id' => $project->id,
            'status' => JobStatus::STATUS_QUEUED,
            'message' => isset($data['resumeToken']) ? 'Resumed upload' : null,
        ]);

        try {
            ImportProjectArchive::dispatchSync($project->id, $status->id, $absolute, $name);
        } catch (\Throwable $e) {
            $status->refresh();
            if ($status->status !== JobStatus::STATUS_FAILED) {
                $status->markFailed($e->getMessage());
            }
            @unlink($absolute);

            return $this->respond([
                'jobId' => $status->id,
                'status' => $status->status,
                'projectId' => $project->id,
                'message' => $status->message ?? $e->getMessage(),
            ], status: 500);
        }

        $status->refresh();

        return $this->respond([
            'jobId' => $status->id,
            'status' => $status->status,
            'projectId' => $project->id,
            'message' => $status->message,
        ], status: $status->status === JobStatus::STATUS_FAILED ? 500 : 202);
    }

    /**
     * @return array<string, mixed>
     */
    private function serializeProject(Project $project): array
    {
        return [
            'id' => $project->id,
            'name' => $project->name,
            'sandboxPath' => $project->sandbox_path,
            'lastImportedAt' => $project->last_imported_at?->toIso8601String(),
            'createdAt' => $project->created_at?->toIso8601String(),
            'updatedAt' => $project->updated_at?->toIso8601String(),
            'fileCount' => $project->files()->count(),
        ];
    }
}
