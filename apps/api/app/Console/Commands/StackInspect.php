<?php

namespace App\Console\Commands;

use App\Services\Import\StackDetector;
use App\Services\Import\UsageReportBuilder;
use Illuminate\Console\Command;
use RuntimeException;

/**
 * DX-32: inspect a codebase's stack profile and C4 usage report in-process.
 *
 * Deliberately bypasses the API, auth, the queue and the database — the
 * question "what does the analyser think this codebase is" needs none of them,
 * and routing it through HTTP made the answer hostage to a running worker.
 *
 * Exists because DX-31 found StackDetector claiming CodeIgniter 3 from folder
 * layout alone. This command makes that class of check a one-liner anyone can
 * re-run whenever detection changes.
 */
class StackInspect extends Command
{
    protected $signature = 'stack:inspect
        {path : Path to the codebase to inspect}
        {--json : Emit JSON only (diffable, machine-readable)}
        {--hide-composer : Temporarily hide composer.json to reproduce the pre-DX-31 condition}';

    protected $description = 'Report the detected stack profile and uses/needs report for a codebase';

    public function handle(StackDetector $detector, UsageReportBuilder $builder): int
    {
        $path = rtrim((string) $this->argument('path'), DIRECTORY_SEPARATOR.'/');

        if (! is_dir($path)) {
            $this->error("Not a directory: {$path}");

            return self::FAILURE;
        }

        $restore = null;
        if ($this->option('hide-composer')) {
            $restore = $this->hideComposer($path);
        }

        try {
            $profile = $detector->detect($path);
            $report = $builder->build($path);

            if ($this->option('json')) {
                $this->line((string) json_encode([
                    'path' => $path,
                    'composerHidden' => $restore !== null,
                    'profile' => [
                        'isCi3' => $profile->isCi3,
                        'isLegacyPhpLayout' => $profile->isLegacyPhpLayout,
                        'hasComposer' => $profile->hasComposer,
                        'hasPackage' => $profile->hasPackage,
                        'hasAngular' => $profile->hasAngular,
                        'hasPlaywright' => $profile->hasPlaywright,
                    ],
                    'report' => $report,
                ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));

                return self::SUCCESS;
            }

            $this->renderHuman($path, $profile, $report, $restore !== null);
        } finally {
            if ($restore !== null) {
                $restore();
            }
        }

        return self::SUCCESS;
    }

    /**
     * Move composer.json aside and return a restorer. Guarantees the file comes
     * back even if detection throws — doing this by hand is how a previous
     * PILOT-2 run ended up measuring the wrong condition.
     *
     * @return callable(): void
     */
    private function hideComposer(string $path): callable
    {
        $composer = $path.DIRECTORY_SEPARATOR.'composer.json';
        if (! is_file($composer)) {
            $this->warn('--hide-composer: no composer.json here, nothing to hide.');

            return static fn () => null;
        }

        $stashed = $composer.'.stack-inspect-bak';
        if (file_exists($stashed)) {
            throw new RuntimeException("Refusing to overwrite an existing {$stashed} — restore it first.");
        }
        if (! @rename($composer, $stashed)) {
            throw new RuntimeException("Could not move {$composer} aside.");
        }

        return function () use ($composer, $stashed): void {
            if (file_exists($stashed) && ! @rename($stashed, $composer)) {
                $this->error("RESTORE FAILED — rename {$stashed} back to composer.json by hand.");
            }
        };
    }

    /** @param array<string, mixed> $report */
    private function renderHuman(string $path, object $profile, array $report, bool $hidden): void
    {
        $yn = static fn (bool $b): string => $b ? '<fg=green>yes</>' : '<fg=gray>no</>';

        $this->newLine();
        $this->line("<options=bold>Codebase</> {$path}");
        if ($hidden) {
            $this->line('<fg=yellow>composer.json hidden for this run (pre-DX-31 condition)</>');
        }

        $this->newLine();
        $this->line('<options=bold>Stack profile</>');
        $this->line('  CodeIgniter 3 (positive markers) : '.$yn($profile->isCi3));
        $this->line('  Legacy application/ + system/    : '.$yn($profile->isLegacyPhpLayout));
        $this->line('  composer.json                    : '.$yn($profile->hasComposer));
        $this->line('  package.json                     : '.$yn($profile->hasPackage));
        $this->line('  angular.json                     : '.$yn($profile->hasAngular));
        $this->line('  playwright config                : '.$yn($profile->hasPlaywright));

        $uses = $report['uses'];
        $needs = $report['needs'];
        $deps = $uses['deps'];
        $bySource = [];
        foreach ($deps as $d) {
            $bySource[$d['source']] = ($bySource[$d['source']] ?? 0) + 1;
        }
        $depSummary = [];
        foreach ($bySource as $src => $n) {
            $depSummary[] = "{$n} {$src}";
        }

        $this->newLine();
        $this->line('<options=bold>Uses</>');
        $this->line('  languages  : '.($uses['languages'] ? implode(', ', $uses['languages']) : '<fg=gray>none</>'));
        $this->line('  frameworks : '.($uses['frameworks'] ? implode(', ', $uses['frameworks']) : '<fg=gray>none</>'));
        $this->line('  deps       : '.count($deps).($depSummary ? ' ('.implode(', ', $depSummary).')' : ''));

        $this->newLine();
        $this->line('<options=bold>Needs</>');
        $this->line('  missingDeps: '.($needs['missingDeps'] ? implode(' | ', $needs['missingDeps']) : '<fg=gray>none</>'));
        $this->line('  envVars    : '.($needs['envVars'] ? implode(' | ', $needs['envVars']) : '<fg=gray>none</>'));
        $this->line('  services   : '.($needs['services'] ? implode(', ', $needs['services']) : '<fg=gray>none</>'));

        $this->newLine();
        if ($profile->isLegacyPhpLayout && ! $profile->isCi3) {
            $this->line('<fg=green>DX-31 OK</> legacy application/ + system/ layout, but no CodeIgniter claimed.');
        }
        if ($needs['services'] === []) {
            $this->line('<fg=yellow>NOTE</> services is empty. Detection only reads .env.example, composer.json,');
            $this->line('     package.json and application/config/database.php — a project keeping DB');
            $this->line('     config elsewhere reports no services even when it clearly has one.');
        }
    }
}
