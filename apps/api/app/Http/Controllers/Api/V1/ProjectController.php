<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Requests\ImportProjectRequest;
use App\Http\Requests\LinkLocalProjectRequest;
use App\Http\Requests\StoreProjectRequest;
use App\Jobs\ImportProjectArchive;
use App\Jobs\LinkLocalProject;
use App\Models\JobStatus;
use App\Models\Project;
use App\Support\Api\ApiResponse;
use App\Support\Sandbox\PathJail;
use Database\Seeders\DemoProjectSeeder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\File;
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
     * Link a folder on the same machine as the API — analyze in place, no zip upload.
     */
    public function linkLocal(LinkLocalProjectRequest $request, Project $project): JsonResponse
    {
        $data = $request->validated();

        $status = JobStatus::query()->create([
            'type' => 'link-local',
            'project_id' => $project->id,
            'status' => JobStatus::STATUS_QUEUED,
        ]);

        try {
            LinkLocalProject::dispatchSync(
                $project->id,
                $status->id,
                $data['path'],
                $data['name'] ?? null,
            );
        } catch (\Throwable $e) {
            $status->refresh();
            if ($status->status !== JobStatus::STATUS_FAILED) {
                $status->markFailed($e->getMessage());
            }

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

    public function destroy(Request $request, Project $project, PathJail $jail): JsonResponse
    {
        if ($project->id === DemoProjectSeeder::DEMO_PROJECT_ID) {
            return ApiResponse::failure([
                ApiResponse::problem(
                    title: 'Conflict',
                    detail: 'The seeded demo project cannot be deleted.',
                    status: 409,
                    instance: $request->getPathInfo(),
                ),
            ], status: 409);
        }

        Cache::forget("graph:{$project->id}");

        if (($project->source_type ?? 'import') !== 'local') {
            $root = $jail->projectRoot($project->id);
            if (is_dir($root)) {
                File::deleteDirectory($root);
            }
        }

        foreach (Storage::disk('local')->files('imports') as $path) {
            if (str_starts_with(basename($path), $project->id.'_')) {
                Storage::disk('local')->delete($path);
            }
        }

        $project->delete();

        return $this->respond(['deleted' => true]);
    }

    /**
     * @return array<string, mixed>
     */
    private function serializeProject(Project $project): array
    {
        return [
            'id' => $project->id,
            'name' => $project->name,
            'sourceType' => $project->source_type ?? 'import',
            'localSourcePath' => $project->local_source_path,
            'sandboxPath' => $project->sandbox_path,
            'lastImportedAt' => $project->last_imported_at?->toIso8601String(),
            'createdAt' => $project->created_at?->toIso8601String(),
            'updatedAt' => $project->updated_at?->toIso8601String(),
            'fileCount' => $project->files()->count(),
        ];
    }
}
