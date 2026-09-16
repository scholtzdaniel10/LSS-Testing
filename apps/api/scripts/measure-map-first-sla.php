<?php

/**
 * One-shot SLA timing: index ~7k PHP files then map→diagnose→snapshot (sync queue).
 * Usage: php scripts/measure-map-first-sla.php
 */

require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\JobStatus;
use App\Models\Project;
use App\Models\ProjectFile;
use App\Support\Jobs\DispatchAnalyzeChain;
use Illuminate\Support\Str;

config([
    'speed.phpstan_progressive' => true,
    'speed.phpstan_first_pass_max_files' => 300,
    'speed.phpstan_shard_concurrency' => 4,
    'queue.default' => 'sync',
]);

$root = storage_path('framework/testing/sla-7k-'.uniqid());
$dirs = ['controllers', 'models', 'libraries', 'views', 'helpers', 'config'];
foreach ($dirs as $d) {
    mkdir($root.'/application/'.$d, 0755, true);
}
mkdir($root.'/system/core', 0755, true);

$n = 0;
foreach ($dirs as $d) {
    for ($i = 0; $i < 1100; $i++) {
        file_put_contents($root."/application/{$d}/F{$i}.php", "<?php\nclass F{$d}{$i} {}\n");
        $n++;
    }
}
for ($i = 0; $i < 400; $i++) {
    file_put_contents($root."/system/core/S{$i}.php", "<?php\nclass S{$i} {}\n");
    $n++;
}
echo "files_on_disk={$n}\n";

$t0 = microtime(true);
$project = Project::query()->create([
    'name' => 'sla-7k-'.uniqid(),
    'source_type' => 'local',
    'local_source_path' => $root,
    'sandbox_path' => $root,
    'last_imported_at' => now(),
]);

$rows = [];
$indexed = 0;
$ri = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS));
foreach ($ri as $f) {
    if (! $f->isFile()) {
        continue;
    }
    $rel = str_replace('\\', '/', substr($f->getPathname(), strlen($root) + 1));
    $rows[] = [
        'id' => (string) Str::uuid(),
        'project_id' => $project->id,
        'path' => $rel,
        'size' => $f->getSize(),
        'lang' => 'php',
        'created_at' => now(),
        'updated_at' => now(),
    ];
    $indexed++;
    if (count($rows) >= 500) {
        ProjectFile::query()->insert($rows);
        $rows = [];
    }
}
if ($rows !== []) {
    ProjectFile::query()->insert($rows);
}
$tLink = microtime(true);
echo sprintf("index_s=%.2f indexed=%d\n", $tLink - $t0, $indexed);

$ids = DispatchAnalyzeChain::dispatch($project->id, 'sla map', 'sla diagnose', 'sla snap');
$tDone = microtime(true);

$map = JobStatus::query()->find($ids['mapJobId']);
$diag = JobStatus::query()->find($ids['diagnoseJobId']);
$snap = JobStatus::query()->find($ids['snapshotJobId']);

echo sprintf("map_status=%s msg=%s\n", $map?->status, $map?->message);
echo sprintf("diagnose_status=%s msg=%s\n", $diag?->status, $diag?->message);
echo sprintf("snapshot_status=%s\n", $snap?->status);
echo sprintf("map+diagnose+snapshot_s=%.2f\n", $tDone - $tLink);
echo sprintf("link_start_to_analyze_done_s=%.2f\n", $tDone - $t0);

$rrmdir = function (string $dir) use (&$rrmdir): void {
    if (! is_dir($dir)) {
        return;
    }
    foreach (scandir($dir) ?: [] as $e) {
        if ($e === '.' || $e === '..') {
            continue;
        }
        $p = $dir.DIRECTORY_SEPARATOR.$e;
        is_dir($p) ? $rrmdir($p) : @unlink($p);
    }
    @rmdir($dir);
};
$rrmdir($root);
