<?php

namespace App\Services\Diagnostics;

use App\Services\Import\StackDetector;
use Illuminate\Support\Facades\Process;

/**
 * DX-23: JavaScript / TypeScript analyser adapter.
 *
 * Runs ESLint and tsc (TypeScript compiler) against the sandbox and normalises
 * their output to C5 findings. Both tools are optional — whichever binaries are
 * available are used; if neither is present, returns an empty list (never
 * fabricates findings). The adapter satisfies the Analyzer interface so no
 * AnalysisRunner changes are needed (IG-22 file-parser pattern applied).
 *
 * parse-never-execute: this adapter ONLY invokes the analyser tools; it never
 * imports or evaluates any code from the scanned project.
 */
class JsAnalyzerAdapter implements Analyzer
{
    private ?string $lastRunStatus = null;

    public function __construct(
        private readonly Taxonomy $taxonomy = new Taxonomy,
        private readonly StackDetector $stackDetector = new StackDetector,
        /** Override ESLint binary path (null = auto-discover via npx). */
        private readonly ?string $eslintBin = null,
        /** Override tsc binary path (null = auto-discover via npx). */
        private readonly ?string $tscBin = null,
    ) {}

    public function source(): string
    {
        return 'js';
    }

    public function runStatus(): ?string
    {
        return $this->lastRunStatus;
    }

    /**
     * Run ESLint + tsc, merge findings, deduplicate (same file+line+ruleId).
     *
     * @return list<array<string, mixed>>
     */
    public function run(string $sandboxPath): array
    {
        $profile = $this->stackDetector->detect($sandboxPath);

        // Only run against projects that have JS/TS content.
        if (! $profile->hasPackage && ! $this->hasJsTs($sandboxPath)) {
            $this->lastRunStatus = 'clean';

            return [];
        }

        $findings = [];
        $findings = array_merge($findings, $this->runEslint($sandboxPath));
        $findings = array_merge($findings, $this->runTsc($sandboxPath));

        // Deduplicate by source+file+line+ruleId
        $seen = [];
        $deduped = [];
        foreach ($findings as $f) {
            $key = $f['source'].':'.$f['file'].':'.$f['range']['startLine'].':'.$f['ruleId'];
            if (! isset($seen[$key])) {
                $seen[$key] = true;
                $deduped[] = $f;
            }
        }

        $this->lastRunStatus = $deduped === [] ? 'clean' : 'ok';

        return $deduped;
    }

    // ── ESLint ────────────────────────────────────────────────────────────────

    /** @return list<array<string, mixed>> */
    private function runEslint(string $sandboxPath): array
    {
        $bin = $this->resolveEslint($sandboxPath);
        if ($bin === null) {
            return [];
        }

        $result = Process::path($sandboxPath)
            ->timeout(300)
            ->run(array_merge($bin, [
                '--format', 'json',
                '--no-eslintrc',
                '--env', 'browser,node,es2022',
                '--parser-options', 'ecmaVersion:2022',
                '.',
            ]));

        return $this->normalizeEslint($result->output(), $sandboxPath);
    }

    /** @return list<array<string, mixed>> */
    private function normalizeEslint(string $json, string $sandboxPath): array
    {
        $decoded = json_decode($json, true);
        if (! is_array($decoded)) {
            return [];
        }

        $root = rtrim(str_replace('\\', '/', $sandboxPath), '/').'/';
        $findings = [];

        foreach ($decoded as $fileResult) {
            if (! is_array($fileResult)) {
                continue;
            }
            $filePath = str_replace('\\', '/', (string) ($fileResult['filePath'] ?? ''));
            if (str_starts_with($filePath, $root)) {
                $filePath = substr($filePath, strlen($root));
            }
            if ($filePath === '') {
                continue;
            }

            foreach (($fileResult['messages'] ?? []) as $msg) {
                if (! is_array($msg)) {
                    continue;
                }
                $line = (int) ($msg['line'] ?? 0);
                if ($line < 1) {
                    continue;
                }
                $ruleId = (string) ($msg['ruleId'] ?? 'eslint.unknown');
                if ($ruleId === '') {
                    $ruleId = 'eslint.unknown';
                }
                $message = (string) ($msg['message'] ?? '');
                if ($message === '') {
                    continue;
                }
                $severity = (int) ($msg['severity'] ?? 2) === 1 ? 'warning' : 'error';
                $classified = $this->taxonomy->classify('eslint', $ruleId, $message);
                $findings[] = [
                    'source' => 'js',
                    'ruleId' => 'eslint:'.$ruleId,
                    'kind' => $classified['kind'],
                    'severity' => $severity,
                    'file' => $filePath,
                    'range' => [
                        'startLine' => $line,
                        'startCol' => max(0, (int) ($msg['column'] ?? 1) - 1),
                        'endLine' => (int) ($msg['endLine'] ?? $line),
                        'endCol' => max(0, (int) ($msg['endColumn'] ?? 1) - 1),
                    ],
                    'message' => $message,
                    'explanation' => $classified['explanation'],
                    'upstream' => [],
                    'downstream' => [],
                ];
            }
        }

        return $findings;
    }

    // ── tsc ───────────────────────────────────────────────────────────────────

    /** @return list<array<string, mixed>> */
    private function runTsc(string $sandboxPath): array
    {
        $bin = $this->resolveTsc($sandboxPath);
        if ($bin === null) {
            return [];
        }

        // noEmit: analyse only, never write output files.
        $result = Process::path($sandboxPath)
            ->timeout(300)
            ->run(array_merge($bin, ['--noEmit', '--pretty', 'false']));

        return $this->normalizeTsc($result->output().$result->errorOutput(), $sandboxPath);
    }

    /** @return list<array<string, mixed>> */
    private function normalizeTsc(string $output, string $sandboxPath): array
    {
        if ($output === '') {
            return [];
        }

        $root = rtrim(str_replace('\\', '/', $sandboxPath), '/');
        $findings = [];

        // tsc line format: path/file.ts(line,col): error TS2304: message
        $pattern = '/^(.+?)\((\d+),(\d+)\):\s+(?:error|warning)\s+(TS\d+):\s+(.+)$/m';
        if (! preg_match_all($pattern, $output, $matches, PREG_SET_ORDER)) {
            return [];
        }

        foreach ($matches as $m) {
            $filePath = str_replace('\\', '/', trim($m[1]));
            $normalRoot = $root.'/';
            if (str_starts_with($filePath, $normalRoot)) {
                $filePath = substr($filePath, strlen($normalRoot));
            }
            $line = max(1, (int) $m[2]);
            $col = max(0, (int) $m[3] - 1);
            $ruleId = $m[4]; // e.g. TS2304
            $message = trim($m[5]);

            $classified = $this->taxonomy->classify('tsc', $ruleId, $message);
            $findings[] = [
                'source' => 'js',
                'ruleId' => 'tsc:'.$ruleId,
                'kind' => $classified['kind'],
                'severity' => 'error',
                'file' => $filePath,
                'range' => [
                    'startLine' => $line,
                    'startCol' => $col,
                    'endLine' => $line,
                    'endCol' => $col,
                ],
                'message' => $message,
                'explanation' => $classified['explanation'],
                'upstream' => [],
                'downstream' => [],
            ];
        }

        return $findings;
    }

    // ── binary resolution ─────────────────────────────────────────────────────

    /** @return list<string>|null */
    private function resolveEslint(string $sandboxPath): ?array
    {
        if ($this->eslintBin !== null) {
            return [$this->eslintBin];
        }
        // Prefer project-local eslint; fall back to npx
        $local = $sandboxPath.'/node_modules/.bin/eslint';
        if (is_file($local)) {
            return [$local];
        }

        // npx --no-install fails gracefully if eslint is absent
        return ['npx', '--no-install', 'eslint'];
    }

    /** @return list<string>|null */
    private function resolveTsc(string $sandboxPath): ?array
    {
        if ($this->tscBin !== null) {
            return [$this->tscBin];
        }
        $local = $sandboxPath.'/node_modules/.bin/tsc';
        if (is_file($local)) {
            return [$local];
        }

        return ['npx', '--no-install', 'tsc'];
    }

    private function hasJsTs(string $root): bool
    {
        $exts = ['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx'];
        $it = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($root, \FilesystemIterator::SKIP_DOTS),
        );
        foreach ($it as $file) {
            if ($file->isFile() && in_array(strtolower($file->getExtension()), $exts, true)) {
                return true;
            }
        }

        return false;
    }
}
