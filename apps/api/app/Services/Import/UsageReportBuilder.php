<?php

namespace App\Services\Import;

use App\Models\Project;
use App\Models\UsageReport;
use Illuminate\Support\Facades\File;

/**
 * IG-5 minimal: scan manifests in the sandbox for a C4 uses/needs report.
 * DX-21: stack detection is delegated to StackDetector (single source of truth).
 * Evidence-only — only claims what files show.
 */
final class UsageReportBuilder
{
    public function __construct(
        private readonly StackDetector $detector = new StackDetector,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function build(string $sandboxPath, ?Project $project = null): array
    {
        $profile = $this->detector->detect($sandboxPath);

        $languages = [];
        $frameworks = [];
        $deps = [];
        $missingDeps = [];
        $envVars = [];
        $services = [];

        if ($project !== null) {
            $langs = $project->files()->whereNotNull('lang')->distinct()->pluck('lang')->all();
            foreach ($langs as $lang) {
                $lang = strtolower((string) $lang);
                if (in_array($lang, ['php', 'javascript', 'typescript'], true)) {
                    $languages[] = $lang;
                }
            }
        } else {
            if ($this->hasPhp($sandboxPath)) {
                $languages[] = 'php';
            }
            if ($this->hasJs($sandboxPath)) {
                $languages[] = 'javascript';
            }
            if ($this->hasTs($sandboxPath)) {
                $languages[] = 'typescript';
            }
        }

        if ($profile->isCi3) {
            $frameworks[] = 'codeigniter-3';
            $missingDeps[] = 'composer.json (CodeIgniter 3 codebase has no Composer autoloader)';
        }
        if ($profile->hasAngular) {
            $frameworks[] = 'angular';
        }
        if ($profile->hasPlaywright) {
            $frameworks[] = 'playwright';
        }
        if ($profile->hasComposer) {
            $frameworks = array_merge($frameworks, $this->composerFrameworks($sandboxPath));
            $deps = array_merge($deps, $this->composerDeps($sandboxPath));
        }
        if ($profile->hasPackage) {
            $deps = array_merge($deps, $this->npmDeps($sandboxPath));
            if (! $profile->hasAngular && $this->hasNpmDependencyPrefixed($sandboxPath, '@ionic/')) {
                $frameworks[] = 'ionic';
            }
            if ($this->hasNpmDependency($sandboxPath, 'react')) {
                $frameworks[] = 'react';
            }
        }

        $envExample = $sandboxPath.DIRECTORY_SEPARATOR.'.env.example';
        if (is_file($envExample)) {
            $envVars = $this->envKeys($envExample);
        } elseif (is_file($sandboxPath.DIRECTORY_SEPARATOR.'.env')) {
            $envVars[] = '(present .env but missing .env.example)';
        }

        if ($this->mentions($sandboxPath, 'redis')) {
            $services[] = 'redis';
        }
        if ($this->mentions($sandboxPath, 'pgsql') || $this->mentions($sandboxPath, 'postgres')) {
            $services[] = 'postgres';
        }
        if ($this->mentions($sandboxPath, 'mysql')) {
            $services[] = 'mysql';
        }

        return [
            'uses' => [
                'languages' => array_values(array_unique($languages)),
                'frameworks' => array_values(array_unique($frameworks)),
                'deps' => $deps,
            ],
            'needs' => [
                'missingDeps' => array_values(array_unique($missingDeps)),
                'envVars' => array_values(array_unique($envVars)),
                'services' => array_values(array_unique($services)),
            ],
        ];
    }

    public function persist(Project $project, array $report): UsageReport
    {
        $existing = $project->usageReport;
        if ($existing) {
            $existing->update(['report' => $report]);

            return $existing->fresh();
        }

        return $project->usageReport()->create(['report' => $report]);
    }

    private function hasPhp(string $root): bool
    {
        return $this->hasExt($root, ['php']);
    }

    private function hasJs(string $root): bool
    {
        return $this->hasExt($root, ['js', 'jsx', 'mjs', 'cjs']);
    }

    private function hasTs(string $root): bool
    {
        return $this->hasExt($root, ['ts', 'tsx']);
    }

    /** @param list<string> $exts */
    private function hasExt(string $root, array $exts): bool
    {
        $iterator = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($root, \FilesystemIterator::SKIP_DOTS),
        );
        $n = 0;
        foreach ($iterator as $file) {
            if (! $file->isFile()) {
                continue;
            }
            $ext = strtolower($file->getExtension());
            if (in_array($ext, $exts, true)) {
                return true;
            }
            if (++$n > 5000) {
                break;
            }
        }

        return false;
    }

    /** @return list<array{name: string, version: string, source: string}> */
    private function composerDeps(string $root): array
    {
        $json = json_decode((string) File::get($root.DIRECTORY_SEPARATOR.'composer.json'), true);
        if (! is_array($json)) {
            return [];
        }
        $out = [];
        foreach (['require', 'require-dev'] as $key) {
            foreach (($json[$key] ?? []) as $name => $version) {
                if ($name === 'php' || str_starts_with((string) $name, 'ext-')) {
                    continue;
                }
                $out[] = [
                    'name' => (string) $name,
                    'version' => (string) $version,
                    'source' => 'composer',
                ];
            }
        }

        return $out;
    }

    /** @return list<string> */
    private function composerFrameworks(string $root): array
    {
        $json = json_decode((string) File::get($root.DIRECTORY_SEPARATOR.'composer.json'), true) ?? [];
        $require = array_merge($json['require'] ?? [], $json['require-dev'] ?? []);
        $out = [];
        if (isset($require['laravel/framework'])) {
            $out[] = 'laravel';
        }

        return $out;
    }

    /** @return list<array{name: string, version: string, source: string}> */
    private function npmDeps(string $root): array
    {
        $json = json_decode((string) File::get($root.DIRECTORY_SEPARATOR.'package.json'), true);
        if (! is_array($json)) {
            return [];
        }
        $out = [];
        foreach (['dependencies', 'devDependencies'] as $key) {
            foreach (($json[$key] ?? []) as $name => $version) {
                $out[] = [
                    'name' => (string) $name,
                    'version' => (string) $version,
                    'source' => 'npm',
                ];
            }
        }

        return $out;
    }

    /**
     * DX-34: exact dependency-key match, not a raw substring search over the
     * whole file - "react" as a substring also matches unrelated packages
     * like "preact" or "reactive-extensions".
     */
    private function hasNpmDependency(string $root, string $name): bool
    {
        return array_key_exists($name, $this->npmDependencyMap($root));
    }

    private function hasNpmDependencyPrefixed(string $root, string $prefix): bool
    {
        foreach (array_keys($this->npmDependencyMap($root)) as $key) {
            if (str_starts_with($key, $prefix)) {
                return true;
            }
        }

        return false;
    }

    /** @return array<string, string> */
    private function npmDependencyMap(string $root): array
    {
        $json = json_decode((string) File::get($root.DIRECTORY_SEPARATOR.'package.json'), true);
        if (! is_array($json)) {
            return [];
        }

        return array_merge($json['dependencies'] ?? [], $json['devDependencies'] ?? []);
    }

    /** @return list<string> */
    private function envKeys(string $path): array
    {
        $keys = [];
        foreach (file($path, FILE_IGNORE_NEW_LINES) ?: [] as $line) {
            $line = trim($line);
            if ($line === '' || str_starts_with($line, '#')) {
                continue;
            }
            $pos = strpos($line, '=');
            if ($pos === false) {
                continue;
            }
            $keys[] = substr($line, 0, $pos);
        }

        return $keys;
    }

    /**
     * DX-33: legacy layouts don't all keep DB config under application/ —
     * system/config/database.{php,conf} is another shape seen in the wild
     * (e.g. a hand-rolled PHP app with a system/ dir of its own, not CI3).
     */
    private function mentions(string $root, string $needle): bool
    {
        foreach ([
            '.env.example',
            'composer.json',
            'package.json',
            'application/config/database.php',
            'system/config/database.php',
            'system/config/database.conf',
        ] as $rel) {
            $path = $root.DIRECTORY_SEPARATOR.str_replace('/', DIRECTORY_SEPARATOR, $rel);
            if (! is_file($path)) {
                continue;
            }

            $contents = (string) File::get($path);
            if (str_ends_with($rel, '.conf')) {
                // .conf files use "# ..." comment lines that can list every
                // supported driver ("ex. PostgreSQL or MySQL") without any
                // of them being configured - strip comments before matching.
                $contents = (string) preg_replace('/^\s*#.*$/m', '', $contents);
            }

            if (str_contains(strtolower($contents), strtolower($needle))) {
                return true;
            }
        }

        return false;
    }
}
