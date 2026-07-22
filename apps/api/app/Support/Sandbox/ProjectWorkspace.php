<?php

namespace App\Support\Sandbox;

use App\Models\LocalRoot;
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
        $prefixes = $this->allAllowedPrefixes();

        if ($prefixes === []) {
            throw new InvalidArgumentException(
                'Local path is not under an allowed root. Add the folder as an allowed root first.',
            );
        }

        if (self::pathIsUnderAnyPrefix($real, $prefixes)) {
            return;
        }

        throw new InvalidArgumentException(
            'Local path is not under an allowed root. Add the folder as an allowed root first.',
        );
    }

    /**
     * Merged prefix list: DB-registered roots first, then env extras.
     *
     * @return list<string>
     */
    private function allAllowedPrefixes(): array
    {
        $dbRoots = LocalRoot::query()->pluck('path')->map('strval')->all();

        /** @var list<string> $envPrefixes */
        $envPrefixes = config('sandbox.local_path_prefixes', []);

        return array_values(array_merge($dbRoots, $envPrefixes));
    }

    /**
     * Case-insensitive, separator-safe prefix check.
     *
     * Normalise both sides: replace backslashes with forward slashes,
     * strip trailing slashes, then lowercase.
     * A path is "under" a prefix iff it equals the prefix OR starts with
     * prefix + '/'.  This prevents C:\LSS matching C:\LSSX.
     *
     * @param  list<string>  $prefixes
     */
    public static function pathIsUnderAnyPrefix(string $real, array $prefixes): bool
    {
        $normalReal = strtolower(rtrim(str_replace('\\', '/', $real), '/'));

        foreach ($prefixes as $prefix) {
            $prefix = trim((string) $prefix);
            if ($prefix === '') {
                continue;
            }
            $resolved = realpath($prefix) ?: $prefix;
            $normalPfx = strtolower(rtrim(str_replace('\\', '/', $resolved), '/'));

            if ($normalReal === $normalPfx
                || str_starts_with($normalReal, $normalPfx . '/')) {
                return true;
            }
        }

        return false;
    }
}
