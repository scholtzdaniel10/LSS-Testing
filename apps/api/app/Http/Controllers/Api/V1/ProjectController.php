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
use App\Support\Cache\ProjectReadCache;
use App\Support\Sandbox\PathJail;
use App\Support\Sandbox\PathNotAllowedException;
use App\Support\Sandbox\ProjectWorkspace;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use InvalidArgumentException;

class ProjectController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $perPage = min(max((int) $request->integer('per_page', 25), 1), 100);

        return $this->respondPaginated(
            Project::query()
                ->withCount('files')
                ->orderBy('name')
                ->paginate($perPage)
                ->through(fn (Project $project): array => $this->serializeProject($project)),
        );
    }

    public function show(Project $project): JsonResponse
    {
        $project->loadCount('files');

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

        ImportProjectArchive::dispatch($project->id, $status->id, $absolute, $name);

        return $this->respond([
            'jobId' => $status->id,
            'status' => $status->status,
            'projectId' => $project->id,
            'message' => $status->message,
        ], status: 202);
    }

    /**
     * Link a folder on the same machine as the API — analyze in place, no zip upload.
     * Path allowlist is checked before queue so path_not_allowed returns 422 immediately.
     */
    public function linkLocal(LinkLocalProjectRequest $request, Project $project, ProjectWorkspace $workspace): JsonResponse
    {
        $data = $request->validated();

        try {
            $workspace->assertLocalRoot($data['path']);
        } catch (PathNotAllowedException $e) {
            return ApiResponse::failure([
                ApiResponse::problem(
                    title: 'Path not allowed',
                    detail: $e->getMessage(),
                    status: 422,
                    type: 'about:blank',
                    extensions: [
                        'code' => PathNotAllowedException::CODE,
                        'rejectedPath' => $e->rejectedPath,
                    ],
                ),
            ], status: 422);
        } catch (InvalidArgumentException $e) {
            return $this->respond([
                'message' => $e->getMessage(),
            ], status: 422);
        }

        $status = JobStatus::query()->create([
            'type' => 'link-local',
            'project_id' => $project->id,
            'status' => JobStatus::STATUS_QUEUED,
        ]);

        LinkLocalProject::dispatch(
            $project->id,
            $status->id,
            $data['path'],
            $data['name'] ?? null,
        );

        return $this->respond([
            'jobId' => $status->id,
            'status' => $status->status,
            'projectId' => $project->id,
            'message' => $status->message,
        ], status: 202);
    }

    public function destroy(Project $project, PathJail $jail): JsonResponse
    {
        ProjectReadCache::forgetProject($project->id);

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
            'sandboxSizeBytes' => $this->sandboxSizeBytes($project),
            'lastImportedAt' => $project->last_imported_at?->toIso8601String(),
            'createdAt' => $project->created_at?->toIso8601String(),
            'updatedAt' => $project->updated_at?->toIso8601String(),
            'fileCount' => $project->files_count ?? $project->files()->count(),
        ];
    }

    /**
     * Prefer persisted size from import; never walk FS on list/show hot path.
     */
    private function sandboxSizeBytes(Project $project): ?int
    {
        if (($project->source_type ?? 'import') === 'local') {
            return null;
        }

        if ($project->sandbox_size_bytes !== null) {
            return (int) $project->sandbox_size_bytes;
        }

        if (! $project->sandbox_path) {
            return 0;
        }

        return ProjectReadCache::remember("size:{$project->id}", function () use ($project): int {
            $root = app(PathJail::class)->projectRoot($project->id);
            if (! is_dir($root)) {
                return 0;
            }
            $total = 0;
            $iterator = new \RecursiveIteratorIterator(
                new \RecursiveDirectoryIterator($root, \FilesystemIterator::SKIP_DOTS),
            );
            foreach ($iterator as $file) {
                if ($file->isFile()) {
                    $total += (int) $file->getSize();
                }
            }
            $project->update(['sandbox_size_bytes' => $total]);

            return $total;
        });
    }
}
