<?php

namespace App\Http\Controllers\Api\V1;

use App\Models\Project;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

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
        ];
    }
}
