<?php

namespace App\Services\Diagnostics;

use App\Models\DiagnosticError;
use App\Models\Project;
use App\Models\Scan;
use Illuminate\Support\Str;

/**
 * DX-1/3: run registered analysers, gate evidence, persist a Scan + errors.
 */
final class AnalysisRunner
{
    /**
     * @param  list<Analyzer>  $analyzers
     */
    public function __construct(
        private readonly EvidenceGate $gate = new EvidenceGate,
        private readonly array $analyzers = [],
    ) {}

    public static function withDefaults(?Analyzer $phpstan = null): self
    {
        return new self(new EvidenceGate, [$phpstan ?? new PhpStanAdapter]);
    }

    /**
     * @return array{scan: Scan, accepted: int, rejected: int}
     */
    public function run(Project $project, string $sandboxPath): array
    {
        $scanHash = hash('sha256', $project->id.'|'.(string) $project->last_imported_at.'|'.microtime(true));
        $scan = $project->scans()->create([
            'scan_hash' => $scanHash,
            'status' => 'running',
        ]);

        $accepted = 0;
        $rejected = 0;

        foreach ($this->analyzers as $analyzer) {
            foreach ($analyzer->run($sandboxPath) as $raw) {
                try {
                    $finding = $this->gate->accept($raw);
                } catch (\InvalidArgumentException) {
                    $rejected++;

                    continue;
                }

                DiagnosticError::query()->create([
                    'id' => (string) Str::uuid(),
                    'scan_id' => $scan->id,
                    'source' => $finding['source'],
                    'rule_id' => $finding['ruleId'],
                    'kind' => $finding['kind'],
                    'severity' => $finding['severity'],
                    'file' => $finding['file'],
                    'range' => $finding['range'],
                    'message' => $finding['message'],
                    'explanation' => $finding['explanation'],
                    'upstream' => $finding['upstream'],
                    'downstream' => $finding['downstream'],
                ]);
                $accepted++;
            }
        }

        $scan->update(['status' => 'done']);

        return ['scan' => $scan->fresh(), 'accepted' => $accepted, 'rejected' => $rejected];
    }
}
