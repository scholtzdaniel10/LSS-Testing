<?php

use Illuminate\Support\Facades\Artisan;

/**
 * DX-32: stack:inspect command — in-process StackDetector/UsageReportBuilder
 * inspection. Test 5 is the opt-in pilot corpus regression (DX-31) and is
 * skipped unless LSS_PILOT_PATH points at a real checkout on disk.
 */
describe('stack:inspect command', function () {
    it('reports the legacy PHP layout fixture without claiming CodeIgniter (DX-31)', function () {
        Artisan::call('stack:inspect', [
            'path' => base_path('tests/fixtures/legacy-php-custom'),
            '--json' => true,
        ]);

        $data = json_decode(Artisan::output(), true);

        expect($data['profile']['isLegacyPhpLayout'])->toBeTrue()
            ->and($data['profile']['isCi3'])->toBeFalse()
            ->and($data['report']['uses']['frameworks'])->not->toContain('codeigniter-3');
    });

    it('reports genuine CodeIgniter 3 for the ci3-mini fixture', function () {
        Artisan::call('stack:inspect', [
            'path' => base_path('tests/fixtures/ci3-mini'),
            '--json' => true,
        ]);

        $data = json_decode(Artisan::output(), true);

        expect($data['profile']['isCi3'])->toBeTrue()
            ->and($data['report']['uses']['frameworks'])->toContain('codeigniter-3');
    });

    it('--hide-composer reproduces the pre-DX-31 trigger condition without a false CI3 claim, and restores composer.json', function () {
        $root = sys_get_temp_dir().DIRECTORY_SEPARATOR.'stack-inspect-'.uniqid();
        mkdir($root.DIRECTORY_SEPARATOR.'application'.DIRECTORY_SEPARATOR.'controllers', 0777, true);
        mkdir($root.DIRECTORY_SEPARATOR.'system', 0777, true);
        file_put_contents($root.DIRECTORY_SEPARATOR.'application'.DIRECTORY_SEPARATOR.'controllers'.DIRECTORY_SEPARATOR.'Home.php', '<?php class Home {}');
        $composerPath = $root.DIRECTORY_SEPARATOR.'composer.json';
        $composerContents = '{"name": "acme/app"}';
        file_put_contents($composerPath, $composerContents);

        Artisan::call('stack:inspect', [
            'path' => $root,
            '--json' => true,
            '--hide-composer' => true,
        ]);
        $data = json_decode(Artisan::output(), true);

        expect(file_exists($composerPath))->toBeTrue()
            ->and(file_get_contents($composerPath))->toBe($composerContents)
            ->and($data['profile']['isLegacyPhpLayout'])->toBeTrue()
            ->and($data['profile']['isCi3'])->toBeFalse();

        $items = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS),
            RecursiveIteratorIterator::CHILD_FIRST
        );
        foreach ($items as $item) {
            $item->isDir() ? rmdir($item->getPathname()) : unlink($item->getPathname());
        }
        rmdir($root);
    });

    it('fails with a clear error on a non-existent path', function () {
        $exitCode = Artisan::call('stack:inspect', [
            'path' => sys_get_temp_dir().DIRECTORY_SEPARATOR.'does-not-exist-'.uniqid(),
        ]);

        expect($exitCode)->not->toBe(0)
            ->and(Artisan::output())->toContain('Not a directory');
    });

    it('does not claim CodeIgniter for the real pilot corpus (opt-in, LSS_PILOT_PATH)', function () {
        $pilotPath = getenv('LSS_PILOT_PATH');
        if ($pilotPath === false || $pilotPath === '' || ! is_dir($pilotPath)) {
            $this->markTestSkipped('LSS_PILOT_PATH not set — opt-in pilot corpus regression skipped.');
        }

        Artisan::call('stack:inspect', [
            'path' => $pilotPath,
            '--json' => true,
            '--hide-composer' => true,
        ]);
        $data = json_decode(Artisan::output(), true);

        expect($data['profile']['isCi3'])->toBeFalse();
    });
});
