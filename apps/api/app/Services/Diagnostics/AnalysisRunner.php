<?php

namespace App\Services\Diagnostics;

use App\Models\DiagnosticError;
use App\Models\Project;
use App\Models\Scan;
use Illuminate\Support\Str;

/**
 * DX-1/3/20/22: run registered analysers, gate evidence, persist a Scan + errors.
 *
 * DX-20: status is read via the polymorphic Analyzer::runStatus() — no instanceof.
 * DX-22: builds an AnalyzerRegistry from the adapter list and passes it to
 *         EvidenceGate so unregistered source ids are rejected.
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
        $adapters = [$phpstan ?? new PhpStanAdapter];
        $registry = new AnalyzerRegistry($adapters);

        return new self(new EvidenceGate($registry), $adapters);
    }

    /**
     * @param  list<Analyzer>  $adapters
     */
    public static function withAdapters(array $adapters): self
    {
        $registry = new AnalyzerRegistry($adapters);

        return new self(new EvidenceGate($registry), $adapters);
    }

    /**
     * @return array{scan: Scan, accepted: int, rejected: int, analysers: array<string, string>}
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
        /** @var array<string, string> $analyserStatus */
        $analyserStatus = [];

        foreach ($this->analyzers as $analyzer) {
            $source = $analyzer->source();
            $findings = $analyzer->run($sandboxPath);

            // DX-20: read status via the interface method — no instanceof check.
            $status = $analyzer->runStatus();
            $analyserStatus[$source] = $status ?? ($findings === [] ? 'clean' : 'ok');

            foreach ($findings as $raw) {
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
                    'explanation' => $finding['explanation'] ?? null,
                    'upstream' => $finding['upstream'] ?? [],
                    'downstream' => $finding['downstream'] ?? [],
                ]);

                $accepted++;
            }
        }

        $scan->update([
            'status' => 'done',
            'analyser_status' => $analyserStatus,
        ]);

        return [
            'scan' => $scan,
            'accepted' => $accepted,
            'rejected' => $rejected,
            'analysers' => $analyserStatus,
        ];
    }
}
