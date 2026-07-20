<?php

namespace App\Services;

use App\Models\DiagnosticError;
use App\Models\Project;
use App\Models\Scan;
use Illuminate\Support\Collection;

/**
 * HD-2: aggregates the latest scan, usage report and graph snapshot into a
 * contract-C2 health snapshot document. Pure computation over the database —
 * no side effects; the BuildHealthSnapshot job persists the result.
 */
class HealthSnapshotBuilder
{
    /**
     * @return array<string, mixed> contract-C2 document
     */
    public function build(Project $project): array
    {
        $filesAnalysed = $project->files()->count();
        $scan = $project->scans()->orderByDesc('created_at')->first();
        $errors = $scan
            ? $scan->errors()->get(['severity', 'file', 'upstream', 'downstream'])
            : collect();
        $report = $project->usageReport()->orderByDesc('created_at')->first()?->report ?? [];
        $edges = $project->graphSnapshots()->orderByDesc('scanned_at')->first()?->edges ?? [];

        $errorCounts = [
            'error' => $errors->where('severity', 'error')->count(),
            'warning' => $errors->where('severity', 'warning')->count(),
            'info' => $errors->where('severity', 'info')->count(),
        ];
        $errorChains = $errors
            ->filter(fn ($e): bool => empty($e->upstream) && ! empty($e->downstream))
            ->count();

        $needs = $report['needs'] ?? [];
        $missingDeps = count($needs['missingDeps'] ?? []);
        $undeclaredEnvVars = count($needs['envVars'] ?? []);
        $outdatedDeps = (int) ($report['uses']['outdatedCount'] ?? 0);

        // No test tables exist yet (TST-2); report the honest zero rather than
        // inventing coverage. The formula treats "no tests" as score 0.
        $testPassRate = 0.0;
        $testsTotal = 0;

        $hotspots = $this->hotspots($errors, $edges, $filesAnalysed);

        $scores = $this->scores(
            $errorCounts,
            $filesAnalysed,
            $missingDeps,
            $undeclaredEnvVars,
            $outdatedDeps,
            $testPassRate,
            $testsTotal,
            $hotspots,
        );

        return [
            'projectId' => $project->id,
            'takenAt' => now()->toIso8601String(),
            'scores' => $scores,
            'metrics' => [
                'errorCounts' => $errorCounts,
                'errorChains' => $errorChains,
                'missingDeps' => $missingDeps,
                'outdatedDeps' => $outdatedDeps,
                'undeclaredEnvVars' => $undeclaredEnvVars,
                'testPassRate' => $testPassRate,
                'testsTotal' => $testsTotal,
                'filesAnalysed' => $filesAnalysed,
                'hotspots' => $hotspots,
            ],
            'topIssues' => $this->topIssues($this->worstErrors($scan), $needs, $hotspots),
        ];
    }

    /**
     * Worst-first: severity is an enum, not alphabetical — rank it explicitly.
     *
     * @return Collection<int, DiagnosticError>
     */
    private function worstErrors(?Scan $scan): Collection
    {
        if ($scan === null) {
            return collect();
        }

        return $scan->errors()
            ->orderByRaw("CASE severity WHEN 'error' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END")
            ->orderBy('id')
            ->limit(3)
            ->get();
    }

    /**
     * Hotspots: dependency in-degree (centrality, normalised) x error density
     * per file. Top files above the configured threshold.
     *
     * @param  Collection<int, DiagnosticError>  $errors
     * @param  array<int, array<string, mixed>>  $edges
     * @return array<int, array<string, mixed>>
     */
    private function hotspots(Collection $errors, array $edges, int $filesAnalysed): array
    {
        if ($edges === [] || $filesAnalysed === 0) {
            return [];
        }

        $inDegree = [];
        foreach ($edges as $edge) {
            $to = $edge['to'] ?? null;
            if (is_string($to) && ! str_starts_with($to, 'pkg:')) {
                $inDegree[$to] = ($inDegree[$to] ?? 0) + 1;
            }
        }
        $maxDegree = max(1, ...array_values($inDegree) ?: [1]);

        $errorsPerFile = $errors->countBy('file');

        $config = config('health.structure');
        $candidates = [];
        foreach ($inDegree as $file => $degree) {
            $centrality = round($degree / $maxDegree, 2);
            $errorDensity = round(min(1.0, ($errorsPerFile[$file] ?? 0) / 5), 2);
            if ($centrality * $errorDensity > $config['hotspot_threshold']) {
                $candidates[] = [
                    'file' => $file,
                    'centrality' => $centrality,
                    'errorDensity' => $errorDensity,
                ];
            }
        }

        usort(
            $candidates,
            fn (array $a, array $b): int => ($b['centrality'] * $b['errorDensity']) <=> ($a['centrality'] * $a['errorDensity']),
        );

        return array_slice($candidates, 0, $config['max_hotspots']);
    }

    /**
     * @param  array{error: int, warning: int, info: int}  $errorCounts
     * @param  array<int, array<string, mixed>>  $hotspots
     * @return array{overall: int, errors: int, dependencies: int, tests: int, structure: int}
     */
    private function scores(
        array $errorCounts,
        int $filesAnalysed,
        int $missingDeps,
        int $undeclaredEnvVars,
        int $outdatedDeps,
        float $testPassRate,
        int $testsTotal,
        array $hotspots,
    ): array {
        $clamp = fn (float $v): int => (int) round(max(0, min(100, $v)));

        $per100Files = $filesAnalysed > 0 ? 100 / $filesAnalysed : 0;
        $penalties = config('health.error_penalties');
        $errorScore = $clamp(100 - $per100Files * (
            $penalties['error'] * $errorCounts['error']
            + $penalties['warning'] * $errorCounts['warning']
            + $penalties['info'] * $errorCounts['info']
        ));

        $dep = config('health.dependency_penalties');
        $dependencyScore = $clamp(
            100
            - $dep['missing_dep'] * $missingDeps
            - $dep['undeclared_env_var'] * $undeclaredEnvVars
            - $dep['outdated_dep'] * $outdatedDeps,
        );

        $testScore = $testsTotal > 0 ? $clamp($testPassRate * 100) : 0;

        $structureScore = $clamp(100 - config('health.structure.hotspot_penalty') * count($hotspots));

        $weights = config('health.weights');
        $overall = $clamp(
            $weights['errors'] * $errorScore
            + $weights['dependencies'] * $dependencyScore
            + $weights['tests'] * $testScore
            + $weights['structure'] * $structureScore,
        );

        return [
            'overall' => $overall,
            'errors' => $errorScore,
            'dependencies' => $dependencyScore,
            'tests' => $testScore,
            'structure' => $structureScore,
        ];
    }

    /**
     * @param  Collection<int, DiagnosticError>  $worstErrors
     * @param  array<string, mixed>  $needs
     * @param  array<int, array<string, mixed>>  $hotspots
     * @return array<int, array<string, mixed>>
     */
    private function topIssues(Collection $worstErrors, array $needs, array $hotspots): array
    {
        $issues = [];

        foreach ($worstErrors as $error) {
            $issues[] = [
                'dimension' => 'errors',
                'refType' => 'error',
                'refId' => $error->id,
                'summary' => $error->message,
            ];
        }

        foreach (array_slice($needs['missingDeps'] ?? [], 0, 2) as $dep) {
            $issues[] = [
                'dimension' => 'dependencies',
                'refType' => 'dep',
                'refId' => $dep,
                'summary' => "Dependency {$dep} is used but not declared",
            ];
        }

        foreach (array_slice($hotspots, 0, 1) as $hotspot) {
            $issues[] = [
                'dimension' => 'structure',
                'refType' => 'file',
                'refId' => $hotspot['file'],
                'summary' => "{$hotspot['file']} is a hotspot (central + error-dense)",
            ];
        }

        return array_slice($issues, 0, 5);
    }
}
