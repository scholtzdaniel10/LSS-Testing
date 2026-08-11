<?php

use App\Services\Import\UsageReportBuilder;

/**
 * DX-33: builds a throwaway sandbox directory for service-detection cases
 * that don't need a checked-in fixture, and removes it after the test runs.
 */
function usageReportSandbox(array $files): string
{
    $root = sys_get_temp_dir().DIRECTORY_SEPARATOR.'usage-report-'.uniqid();
    mkdir($root, 0777, true);

    foreach ($files as $relativePath => $contents) {
        $path = $root.DIRECTORY_SEPARATOR.str_replace('/', DIRECTORY_SEPARATOR, $relativePath);
        if (! is_dir(dirname($path))) {
            mkdir(dirname($path), 0777, true);
        }
        file_put_contents($path, $contents);
    }

    return $root;
}

function usageReportCleanup(string $root): void
{
    $items = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::CHILD_FIRST
    );
    foreach ($items as $item) {
        $item->isDir() ? rmdir($item->getPathname()) : unlink($item->getPathname());
    }
    rmdir($root);
}

it('detects postgres from system/config/database.conf (DX-33)', function () {
    $root = usageReportSandbox([
        'system/config/database.conf' => "server = PostgreSQL\nhost = localhost\n",
    ]);

    $report = (new UsageReportBuilder)->build($root);
    usageReportCleanup($root);

    expect($report['needs']['services'])->toContain('postgres');
});

it('detects mysql from system/config/database.conf (DX-33)', function () {
    $root = usageReportSandbox([
        'system/config/database.conf' => "server = MySQL\nhost = localhost\n",
    ]);

    $report = (new UsageReportBuilder)->build($root);
    usageReportCleanup($root);

    expect($report['needs']['services'])->toContain('mysql');
});

it('still detects postgres from application/config/database.php (regression)', function () {
    $root = usageReportSandbox([
        'application/config/database.php' => "<?php \$db['default']['dbdriver'] = 'pgsql';",
    ]);

    $report = (new UsageReportBuilder)->build($root);
    usageReportCleanup($root);

    expect($report['needs']['services'])->toContain('postgres');
});

it('ignores a driver name mentioned only in a .conf comment line (DX-33)', function () {
    $root = usageReportSandbox([
        'system/config/database.conf' => "# This is the database server, ex. PostgreSQL or MySQL\nserver = PostgreSQL\n",
    ]);

    $report = (new UsageReportBuilder)->build($root);
    usageReportCleanup($root);

    expect($report['needs']['services'])->toContain('postgres')
        ->and($report['needs']['services'])->not->toContain('mysql');
});

it('reports no services when nothing mentions a known database', function () {
    $root = usageReportSandbox([
        'README.md' => '# Just a readme',
    ]);

    $report = (new UsageReportBuilder)->build($root);
    usageReportCleanup($root);

    expect($report['needs']['services'])->toBe([]);
});

it('does not claim CodeIgniter and does detect postgres for the real pilot corpus (opt-in, LSS_PILOT_PATH)', function () {
    $pilotPath = getenv('LSS_PILOT_PATH');
    if ($pilotPath === false || $pilotPath === '' || ! is_dir($pilotPath)) {
        $this->markTestSkipped('LSS_PILOT_PATH not set — opt-in pilot corpus regression skipped.');
    }

    $report = (new UsageReportBuilder)->build($pilotPath);

    expect($report['needs']['services'])->toContain('postgres');
});
