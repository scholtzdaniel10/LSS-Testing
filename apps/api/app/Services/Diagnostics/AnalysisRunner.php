<?php

namespace App\Services\Diagnostics;

use App\Models\DiagnosticError;
use App\Models\Project;
use App\Models\Scan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Str;

/**
 * DX-1/3/20/22: run registered analysers, gate evidence, persist a Scan + errors.
 *
 * Supports progressive PHPStan shard flushes and optional Redis findings buffer.
 */
final class AnalysisRunner
{
    private const INSERT_CHUNK = 200;

    /**
     * @param  list<Analyzer>  $analyzers
     */
    public function __construct(
        private readonly EvidenceGate $gate = new EvidenceGate,
        private readonly array $analyzers = [],
    ) {}

    public static function withDefaults(?Analyzer $phpstan = null): self
    {
        $adapters = self::defaultAdapters($phpstan);
        $registry = new AnalyzerRegistry($adapters);

        return new self(new EvidenceGate($registry), $adapters);
    }

    /**
     * @return list<Analyzer>
     */
    public static function defaultAdapters(?Analyzer $phpstan = null): array
    {
        $adapters = [];

        if (config('diagnostics.phpstan', true)) {
            $adapters[] = $phpstan ?? new PhpStanAdapter;
        }
        if (config('diagnostics.js', true)) {
            $adapters[] = new JsAnalyzerAdapter;
        }
        if (config('diagnostics.php_test', true)) {
            $adapters[] = new PhpTestFrameworkAdapter;
        }
        if (config('diagnostics.phpcs', true)) {
            $adapters[] = new PhpcsAdapter;
        }
        if (config('diagnostics.phpmd', true)) {
            $adapters[] = new PhpmdAdapter;
        }

        return $adapters;
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
     * @param  callable(int $accepted, int $rejected, string $label, int $shardIndex, int $shardTotal): void|null  $onProgress
     * @param  list<string>|null  $phpstanPaths  When set, PHPStan analyzes only these relative paths (incremental).
     * @return array{scan: Scan, accepted: int, rejected: int, analysers: array<string, string>}
     */
    public function run(Project $project, string $sandboxPath, ?callable $onProgress = null, ?array $phpstanPaths = null): array
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
        $bufferKey = "findings:{$scan->id}";
        $useBuffer = (bool) config('speed.findings_buffer', false)
            && config('cache.default') === 'redis';

        foreach ($this->analyzers as $analyzer) {
            $source = $analyzer->source();

            if ($analyzer instanceof PhpStanAdapter && config('speed.phpstan_shards', true) && ! $analyzer->usesInjectedRunner()) {
                $shards = $analyzer->planShards($sandboxPath, $phpstanPaths);
                $shardTotal = max(1, count($shards));
                $shardIndex = 0;
                $allFindings = [];

                if ($shards === []) {
                    $findings = $analyzer->run($sandboxPath);
                    $allFindings = $findings;
                } else {
                    foreach ($shards as $shard) {
                        $shardIndex++;
                        $label = $shard['label'];
                        $findings = $analyzer->runShard($sandboxPath, $shard['paths'], $label);
                        $allFindings = array_merge($allFindings, $findings);

                        [$a, $r] = $this->persistFindings($scan, $findings, $useBuffer ? $bufferKey : null);
                        $accepted += $a;
                        $rejected += $r;
                        if ($onProgress !== null) {
                            $onProgress($accepted, $rejected, $label, $shardIndex, $shardTotal);
                        }

                        if ($useBuffer) {
                            $this->flushFindingsBuffer($bufferKey);
                        }
                    }
                }

                if ($shards === []) {
                    [$a, $r] = $this->persistFindings($scan, $allFindings, $useBuffer ? $bufferKey : null);
                    $accepted += $a;
                    $rejected += $r;
                    if ($useBuffer) {
                        $this->flushFindingsBuffer($bufferKey);
                    }
                }

                $status = $analyzer->runStatus();
                $analyserStatus[$source] = $status ?? ($allFindings === [] ? 'clean' : 'ok');

                continue;
            }

            $findings = $analyzer->run($sandboxPath);
            $status = $analyzer->runStatus();
            $analyserStatus[$source] = $status ?? ($findings === [] ? 'clean' : 'ok');

            [$a, $r] = $this->persistFindings($scan, $findings, $useBuffer ? $bufferKey : null);
            $accepted += $a;
            $rejected += $r;
            if ($useBuffer) {
                $this->flushFindingsBuffer($bufferKey);
            }
            if ($onProgress !== null) {
                $onProgress($accepted, $rejected, $source, 1, 1);
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

    /**
     * Apply upstream/downstream/chain in one transaction with chunked updates.
     *
     * @param  list<array{from: string, to: string, kind?: string, line?: int|null}>  $edges
     */
    public function applyImpactAndChains(Scan $scan, array $edges): void
    {
        $resolver = new ImpactResolver($edges);
        $errors = $scan->errors()->get();
        if ($errors->isEmpty()) {
            return;
        }

        $chains = (new ChainDetector)->detect(
            $errors->map(fn ($error): array => ['id' => $error->id, 'file' => $error->file])->all(),
            $resolver,
        );

        DB::transaction(function () use ($errors, $resolver, $chains): void {
            foreach ($errors->chunk(100) as $chunk) {
                foreach ($chunk as $error) {
                    $assignment = $chains[$error->id] ?? null;
                    $error->update([
                        'upstream' => $resolver->upstream($error->file),
                        'downstream' => $resolver->downstream($error->file),
                        'chain_id' => $assignment['chainId'] ?? null,
                        'is_root' => (bool) ($assignment['isRoot'] ?? false),
                    ]);
                }
            }
        });
    }

    /**
     * @param  list<array<string, mixed>>  $findings
     * @return array{0: int, 1: int} accepted, rejected
     */
    private function persistFindings(Scan $scan, array $findings, ?string $bufferKey): array
    {
        $accepted = 0;
        $rejected = 0;
        $rows = [];
        $now = now();

        foreach ($findings as $raw) {
            try {
                $finding = $this->gate->accept($raw);
            } catch (\InvalidArgumentException) {
                $rejected++;

                continue;
            }

            $row = [
                'id' => (string) Str::uuid(),
                'scan_id' => $scan->id,
                'source' => $finding['source'],
                'rule_id' => $finding['ruleId'],
                'kind' => $finding['kind'],
                'severity' => $finding['severity'],
                'file' => $finding['file'],
                'range' => json_encode($finding['range'], JSON_THROW_ON_ERROR),
                'message' => $finding['message'],
                'explanation' => $finding['explanation'] ?? null,
                'upstream' => json_encode($finding['upstream'] ?? [], JSON_THROW_ON_ERROR),
                'downstream' => json_encode($finding['downstream'] ?? [], JSON_THROW_ON_ERROR),
                'chain_id' => null,
                'is_root' => false,
                'created_at' => $now,
                'updated_at' => $now,
            ];

            if ($bufferKey !== null) {
                Redis::rpush($bufferKey, json_encode($row, JSON_THROW_ON_ERROR));
            } else {
                $rows[] = $row;
            }
            $accepted++;
        }

        foreach (array_chunk($rows, self::INSERT_CHUNK) as $chunk) {
            DiagnosticError::query()->insert($chunk);
        }

        return [$accepted, $rejected];
    }

    private function flushFindingsBuffer(string $bufferKey): void
    {
        $encoded = Redis::lrange($bufferKey, 0, -1);
        Redis::del($bufferKey);
        if (! is_array($encoded) || $encoded === []) {
            return;
        }

        $rows = [];
        foreach ($encoded as $item) {
            $decoded = json_decode((string) $item, true);
            if (is_array($decoded)) {
                $rows[] = $decoded;
            }
        }
        foreach (array_chunk($rows, self::INSERT_CHUNK) as $chunk) {
            DiagnosticError::query()->insert($chunk);
        }
    }
}
