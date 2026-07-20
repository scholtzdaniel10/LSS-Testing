<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Requests\FileContentRequest;
use App\Models\Project;
use App\Models\ProjectFile;
use App\Support\Sandbox\PathJail;
use Illuminate\Http\JsonResponse;
use InvalidArgumentException;

/**
 * IG-3: path-jailed tree + file content APIs.
 */
class ProjectFileController extends Controller
{
    public function tree(Project $project): JsonResponse
    {
        $files = $project->files()
            ->orderBy('path')
            ->get(['path', 'size', 'lang']);

        $tree = [];
        foreach ($files as $file) {
            /** @var ProjectFile $file */
            $tree[] = [
                'path' => $file->path,
                'size' => $file->size,
                'lang' => $file->lang,
            ];
        }

        return $this->respond($tree, [
            'count' => count($tree),
            'reason' => count($tree) === 0 ? 'not-imported-yet' : null,
        ]);
    }

    public function show(FileContentRequest $request, Project $project, PathJail $jail): JsonResponse
    {
        $path = $request->validated()['path'];
        $record = $project->files()->where('path', $path)->first();

        // Seeded demos (and not-yet-imported rows) may have DB metadata without
        // a sandbox on disk — return a soft miss instead of path-jail 500s.
        try {
            $absolute = $jail->resolve($project->id, $path);
        } catch (InvalidArgumentException $e) {
            return response()->json([
                'data' => null,
                'meta' => ['version' => 'v1'],
                'errors' => [[
                    'status' => 403,
                    'title' => 'Forbidden',
                    'detail' => $e->getMessage(),
                ]],
            ], 403);
        } catch (\RuntimeException $e) {
            if ($record === null) {
                return response()->json([
                    'data' => null,
                    'meta' => ['version' => 'v1'],
                    'errors' => [[
                        'status' => 404,
                        'title' => 'Not Found',
                        'detail' => 'File not found in project.',
                    ]],
                ], 404);
            }

            return $this->respond([
                'path' => $path,
                'binary' => false,
                'content' => null,
                'size' => $record->size,
                'lang' => $record->lang,
                'missingOnDisk' => true,
            ]);
        }

        if (! is_file($absolute)) {
            if ($record === null) {
                return response()->json([
                    'data' => null,
                    'meta' => ['version' => 'v1'],
                    'errors' => [[
                        'status' => 404,
                        'title' => 'Not Found',
                        'detail' => 'File not found in project.',
                    ]],
                ], 404);
            }

            return $this->respond([
                'path' => $path,
                'binary' => false,
                'content' => null,
                'size' => $record->size,
                'lang' => $record->lang,
                'missingOnDisk' => true,
            ]);
        }

        $max = (int) config('sandbox.max_file_bytes', 512_000);
        $size = filesize($absolute) ?: 0;
        $isBinary = $this->looksBinary($absolute);

        if ($isBinary) {
            return $this->respond([
                'path' => $path,
                'binary' => true,
                'content' => null,
                'size' => $size,
                'lang' => $project->files()->where('path', $path)->value('lang'),
            ]);
        }

        $content = file_get_contents($absolute, false, null, 0, $max + 1);
        $truncated = is_string($content) && strlen($content) > $max;

        return $this->respond([
            'path' => $path,
            'binary' => false,
            'content' => $truncated && is_string($content) ? substr($content, 0, $max) : $content,
            'truncated' => $truncated,
            'size' => $size,
            'lang' => $project->files()->where('path', $path)->value('lang'),
        ]);
    }

    private function looksBinary(string $path): bool
    {
        $fh = fopen($path, 'rb');
        if ($fh === false) {
            return true;
        }
        $chunk = fread($fh, 8000);
        fclose($fh);
        if ($chunk === false || $chunk === '') {
            return false;
        }

        return str_contains($chunk, "\0");
    }
}
