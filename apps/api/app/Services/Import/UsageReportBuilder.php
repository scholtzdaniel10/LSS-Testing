<?php

namespace App\Services\Import;

use App\Models\Project;
use App\Models\UsageReport;
use Illuminate\Support\Facades\File;

/**
 * IG-5 minimal: scan manifests in the sandbox for a C4 uses/needs report.
 * Evidence-only — only claims what files show.
 */
final class UsageReportBuilder
{
    /**
     * @return array<string, mixed>
     */
    public function build(string $sandboxPath): array
    {
        $languages = [];
        $frameworks = [];
        $deps = [];
        $missingDeps = [];
        $envVars = [];
        $services = [];

        $hasComposer = is_file($sandboxPath.DIRECTORY_SEPARATOR.'composer.json');
        $hasPackage = is_file($sandboxPath.DIRECTORY_SEPARATOR.'package.json');
        $hasAngular = is_file($sandboxPath.DIRECTORY_SEPARATOR.'angular.json');
        $hasPlaywright = is_file($sandboxPath.DIRECTORY_SEPARATOR.'playwright.config.ts')
            || is_file($sandboxPath.DIRECTORY_SEPARATOR.'playwright.config.js');
        $isCi3 = is_dir($sandboxPath.DIRECTORY_SEPARATOR.'application')
            && is_dir($sandboxPath.DIRECTORY_SEPARATOR.'system')
            && ! $hasComposer;

        if ($this->hasPhp($sandboxPath)) {
            $languages[] = 'php';
        }
        if ($this->hasJs($sandboxPath)) {
            $languages[] = 'javascript';
        }
        if ($this->hasTs($sandboxPath)) {
            $languages[] = 'typescript';
        }

        if ($isCi3) {
            $frameworks[] = 'codeigniter-3';
            $missingDeps[] = 'composer.json (CodeIgniter 3 codebase has no Composer autoloader)';
        }
        if ($hasAngular) {
            $frameworks[] = 'angular';
        }
        if ($hasPlaywright) {
            $frameworks[] = 'playwright';
        }
        if ($hasComposer) {
            $frameworks = array_merge($frameworks, $this->composerFrameworks($sandboxPath));
            $deps = array_merge($deps, $this->composerDeps($sandboxPath));
        }
        if ($hasPackage) {
            $deps = array_merge($deps, $this->npmDeps($sandboxPath));
            if (! $hasAngular && $this->packageHas($sandboxPath, '@ionic')) {
                $frameworks[] = 'ionic';
            }
            if ($this->packageHas($sandboxPath, 'react')) {
                $frameworks[] = 'react';
            }
            if ($this->packageHas($sandboxPath, 'laravel-vite-plugin') || $this->packageHas($sandboxPath, 'vite')) {
                // not a framework claim beyond tooling — skip
            }
        }

        $envExample = $sandboxPath.DIRECTORY_SEPARATOR.'.env.example';
        if (is_file($envExample)) {
            $envVars = $this->envKeys($envExample);
        } elseif (is_file($sandboxPath.DIRECTORY_SEPARATOR.'.env')) {
            // Presence of .env without .env.example is a need signal, not a secret dump.
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

    private function packageHas(string $root, string $needle): bool
    {
        $raw = (string) File::get($root.DIRECTORY_SEPARATOR.'package.json');

        return str_contains($raw, $needle);
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

    private function mentions(string $root, string $needle): bool
    {
        foreach (['.env.example', 'composer.json', 'package.json', 'application/config/database.php'] as $rel) {
            $path = $root.DIRECTORY_SEPARATOR.str_replace('/', DIRECTORY_SEPARATOR, $rel);
            if (is_file($path) && str_contains(strtolower((string) File::get($path)), strtolower($needle))) {
                return true;
            }
        }

        return false;
    }
}
