<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Requests\StoreTargetEnvironmentRequest;
use App\Models\Project;
use App\Models\TargetEnvironment;
use Illuminate\Http\Client\Factory as HttpFactory;
use Illuminate\Http\JsonResponse;

/**
 * TST-1: target environment CRUD + reachability probe.
 */
class TargetEnvironmentController extends Controller
{
    public function index(Project $project): JsonResponse
    {
        $items = $project->targetEnvironments()
            ->orderBy('name')
            ->get()
            ->map(fn (TargetEnvironment $env): array => $this->serialize($env));

        return $this->respond($items);
    }

    public function store(StoreTargetEnvironmentRequest $request, Project $project): JsonResponse
    {
        $data = $request->validated();
        $env = $project->targetEnvironments()->updateOrCreate(
            ['name' => $data['name']],
            [
                'base_url' => $data['baseUrl'],
                'notes' => $data['notes'] ?? null,
            ],
        );

        return $this->respond($this->serialize($env), status: 201);
    }

    public function destroy(Project $project, TargetEnvironment $targetEnvironment): JsonResponse
    {
        abort_unless($targetEnvironment->project_id === $project->id, 404);
        $targetEnvironment->delete();

        return $this->respond(['deleted' => true]);
    }

    public function probe(Project $project, TargetEnvironment $targetEnvironment, HttpFactory $http): JsonResponse
    {
        abort_unless($targetEnvironment->project_id === $project->id, 404);

        try {
            $response = $http->timeout(5)->get($targetEnvironment->base_url);
            $reachable = $response->successful() || $response->redirect();
            $status = $response->status();
        } catch (\Throwable $e) {
            return $this->respond([
                'reachable' => false,
                'status' => null,
                'error' => $e->getMessage(),
            ]);
        }

        return $this->respond([
            'reachable' => $reachable,
            'status' => $status,
            'error' => null,
        ]);
    }

    /** @return array<string, mixed> */
    private function serialize(TargetEnvironment $env): array
    {
        return [
            'id' => $env->id,
            'projectId' => $env->project_id,
            'name' => $env->name,
            'baseUrl' => $env->base_url,
            'notes' => $env->notes,
        ];
    }
}
