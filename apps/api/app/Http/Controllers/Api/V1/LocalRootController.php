<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Requests\StoreLocalRootRequest;
use App\Models\LocalRoot;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;

/**
 * DSK-7 — consented local roots.
 *
 * GET  /local-roots           list all registered roots
 * POST /local-roots           register a new root (idempotent)
 * DELETE /local-roots/{id}    remove a root
 *
 * Deleting a root does NOT unlink already-linked projects; their
 * local_source_path is stored on Project and remains readable.
 * Removal only blocks future link-local requests to that path.
 */
class LocalRootController extends Controller
{
    public function index(): JsonResponse
    {
        $roots = LocalRoot::query()->orderBy('path')->get();

        return $this->respond(
            $roots->map(fn (LocalRoot $r): array => $this->serialize($r))->values()->all(),
        );
    }

    public function store(StoreLocalRootRequest $request): JsonResponse
    {
        $raw = (string) $request->validated('path');

        // Validate shape: must be absolute.
        if (! $this->isAbsolutePath($raw)) {
            return ApiResponse::failure([
                ApiResponse::problem(
                    title: 'Invalid path',
                    detail: 'Path must be absolute (e.g. C:\\Projects\\my-app or /home/user/projects/my-app).',
                    status: 422,
                    type: 'about:blank',
                ),
            ], status: 422);
        }

        $normalized = $this->normalizePath($raw);

        // Server-side existence check.
        if (! is_dir($normalized)) {
            return ApiResponse::failure([
                ApiResponse::problem(
                    title: 'Directory not found',
                    detail: 'The directory does not exist on this machine or is not accessible by the API process.',
                    status: 422,
                    type: 'about:blank',
                ),
            ], status: 422);
        }

        // Idempotent: return existing record with 200 rather than erroring.
        $existing = LocalRoot::query()->where('path', $normalized)->first();
        if ($existing instanceof LocalRoot) {
            return $this->respond($this->serialize($existing));
        }

        $root = LocalRoot::query()->create(['path' => $normalized]);

        return $this->respond($this->serialize($root), status: 201);
    }

    public function destroy(LocalRoot $localRoot): JsonResponse
    {
        $localRoot->delete();

        return response()->json(null, 204);
    }

    /** @return array<string, mixed> */
    private function serialize(LocalRoot $root): array
    {
        return [
            'id'        => $root->id,
            'path'      => $root->path,
            'createdAt' => $root->created_at?->toIso8601String(),
            'updatedAt' => $root->updated_at?->toIso8601String(),
        ];
    }

    /**
     * Normalise a path for consistent storage:
     *   - trim leading/trailing whitespace
     *   - strip trailing slashes/backslashes
     *   - do NOT lowercase (preserve case for display; comparison is case-folded)
     */
    private function normalizePath(string $raw): string
    {
        return rtrim(trim($raw), '/\\');
    }

    /**
     * Shape-only absolute-path check (no filesystem access).
     * Accepts Windows (C:\...) and Unix (/...) forms.
     */
    private function isAbsolutePath(string $path): bool
    {
        $path = trim($path);
        // Unix absolute
        if (str_starts_with($path, '/')) {
            return true;
        }
        // Windows absolute: drive letter + colon + separator
        if (preg_match('/^[A-Za-z]:[\\\\\/]/', $path)) {
            return true;
        }
        // Windows UNC \\server\share
        if (str_starts_with($path, '\\\\')) {
            return true;
        }
        return false;
    }
}
