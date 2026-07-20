<?php

namespace App\Support\Sandbox;

use App\Models\Project;
use InvalidArgumentException;
use RuntimeException;

/**
 * Resolves analysis/read roots for imported sandboxes vs user-linked local folders.
 */
final class ProjectWorkspace
{
    public function __construct(
        private readonly PathJail $jail,
    ) {}

    public function root(Project $project): string
    {
        if (($project->source_type ?? 'import') === 'local') {
            return $this->assertLocalRoot((string) $project->local_source_path);
        }

        if ($project->sandbox_path === null || $project->sandbox_path === '') {
            throw new RuntimeException('Project has no linked source; import or link a local folder first.');
        }

        return $this->jail->assertInsideProject($project->id, $project->sandbox_path);
    }

    public function resolve(Project $project, string $relativePath): string
    {
        return $this->jail->resolveUnder($this->root($project), $relativePath);
    }

    public function assertLocalRoot(string $path): string
    {
        $path = trim($path);
        if ($path === '') {
            throw new InvalidArgumentException('Local source path is required.');
        }

        if (! config('sandbox.allow_local_link', true)) {
            throw new InvalidArgumentException('Local path linking is disabled on this API.');
        }

        $real = realpath($path);
        if ($real === false || ! is_dir($real)) {
            throw new InvalidArgumentException('Local source path is not an accessible directory.');
        }

        $this->assertAllowlisted($real);

        return $real;
    }

    private function assertAllowlisted(string $real): void
    {
        /** @var list<string> $prefixes */
        $prefixes = config('sandbox.local_path_prefixes', []);
        if ($prefixes === []) {
            return;
        }

        foreach ($prefixes as $prefix) {
            $prefix = trim($prefix);
            if ($prefix === '') {
                continue;
            }
            $prefixReal = realpath($prefix) ?: $prefix;
            $prefixReal = rtrim(str_replace('\\', '/', $prefixReal), '/');
            $normalized = str_replace('\\', '/', $real);
            if ($normalized === $prefixReal || str_starts_with($normalized, $prefixReal.'/')) {
                return;
            }
        }

        throw new InvalidArgumentException('Local path is not under an allowed root prefix.');
    }
}
