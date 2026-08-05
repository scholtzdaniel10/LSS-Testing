<?php

namespace App\Console\Commands;

use App\Services\Import\StackDetector;
use App\Services\Import\UsageReportBuilder;
use Illuminate\Console\Command;

/**
 * DX-32: in-process StackDetector + UsageReportBuilder inspection for a
 * directory on disk — no API, token, queue, or DB involved. Replaces the
 * ad-hoc PowerShell scripts previously used to eyeball this output.
 */
class StackInspect extends Command
{
    protected $signature = 'stack:inspect {path : Directory to inspect}
        {--json : Output raw JSON instead of a formatted summary}
        {--hide-composer : Temporarily rename composer.json aside (restored afterward) to reproduce detection without a Composer autoloader}';

    protected $description = 'Inspect StackDetector + UsageReportBuilder output for a directory on disk';

    public function handle(StackDetector $detector, UsageReportBuilder $builder): int
    {
        $raw = (string) $this->argument('path');
        $path = realpath($raw);

        if ($path === false || ! is_dir($path)) {
            $this->error("Not a directory: {$raw}");

            return self::FAILURE;
        }

        $hiddenComposer = $this->option('hide-composer') ? $this->hideComposer($path) : null;

        try {
            $profile = $detector->detect($path);
            $report = $builder->build($path);
        } finally {
            if ($hiddenComposer !== null) {
                rename($hiddenComposer, $path.DIRECTORY_SEPARATOR.'composer.json');
            }
        }

        $profileArray = [
            'isLegacyPhpLayout' => $profile->isLegacyPhpLayout,
            'isCi3' => $profile->isCi3,
            'hasComposer' => $profile->hasComposer,
            'hasPackage' => $profile->hasPackage,
            'hasAngular' => $profile->hasAngular,
            'hasPlaywright' => $profile->hasPlaywright,
        ];

        if ($this->option('json')) {
            $this->line((string) json_encode(
                ['profile' => $profileArray, 'report' => $report],
                JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES
            ));

            return self::SUCCESS;
        }

        $this->info("Stack profile for {$path}");
        $this->table(['Flag', 'Value'], array_map(
            fn (string $flag, bool $value) => [$flag, $value ? 'yes' : 'no'],
            array_keys($profileArray),
            array_values($profileArray)
        ));

        $this->newLine();
        $this->info('uses');
        $this->line('  languages:  '.implode(', ', $report['uses']['languages'] ?: ['(none)']));
        $this->line('  frameworks: '.implode(', ', $report['uses']['frameworks'] ?: ['(none)']));
        $this->line('  deps:       '.count($report['uses']['deps']).' total');

        $this->newLine();
        $this->info('needs');
        $this->line('  missingDeps: '.implode(', ', $report['needs']['missingDeps'] ?: ['(none)']));
        $this->line('  envVars:     '.implode(', ', $report['needs']['envVars'] ?: ['(none)']));
        $this->line('  services:    '.implode(', ', $report['needs']['services'] ?: ['(none)']));

        return self::SUCCESS;
    }

    /**
     * Renames composer.json aside so detection runs as if it were absent,
     * returning the temp path for handle()'s finally block to restore —
     * guaranteed even if detection throws.
     */
    private function hideComposer(string $path): ?string
    {
        $composer = $path.DIRECTORY_SEPARATOR.'composer.json';
        if (! is_file($composer)) {
            return null;
        }

        $hidden = $composer.'.stack-inspect-hidden';
        rename($composer, $hidden);

        return $hidden;
    }
}
