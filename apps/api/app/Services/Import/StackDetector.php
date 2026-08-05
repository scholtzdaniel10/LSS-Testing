<?php

namespace App\Services\Import;

/**
 * DX-21: centralised stack-detection logic.
 *
 * Previously the CodeIgniter 3 check ($isCi3) was duplicated in both
 * UsageReportBuilder and PhpStanAdapter. This class is the single source of
 * truth; both consumers receive a StackProfile.
 */
final class StackDetector
{
    /**
     * Inspect the sandbox directory and return a StackProfile.
     */
    public function detect(string $sandboxPath): StackProfile
    {
        $sep = DIRECTORY_SEPARATOR;

        $hasComposer = is_file($sandboxPath.$sep.'composer.json');
        $hasPackage = is_file($sandboxPath.$sep.'package.json');
        $hasAngular = is_file($sandboxPath.$sep.'angular.json');
        $hasPlaywright = is_file($sandboxPath.$sep.'playwright.config.ts')
            || is_file($sandboxPath.$sep.'playwright.config.js');

        $hasLegacyDirs = is_dir($sandboxPath.$sep.'application')
            && is_dir($sandboxPath.$sep.'system');

        // Legacy PHP layout: application/ + system/ with no Composer autoloader.
        // Drives PHPStan strategy only — says nothing about which framework.
        $isLegacyPhpLayout = $hasLegacyDirs && ! $hasComposer;

        // CodeIgniter 3 requires positive evidence (DX-31). The layout alone is
        // not proof: hand-rolled PHP frameworks use application/ + system/ too,
        // which made every such codebase report as CodeIgniter 3.
        $isCi3 = $hasLegacyDirs && $this->hasCodeIgniterMarkers($sandboxPath);

        return new StackProfile(
            isCi3: $isCi3,
            isLegacyPhpLayout: $isLegacyPhpLayout,
            hasComposer: $hasComposer,
            hasPackage: $hasPackage,
            hasAngular: $hasAngular,
            hasPlaywright: $hasPlaywright,
        );
    }

    /**
     * Positive CodeIgniter 3 marker files/directories shipped by the framework
     * itself. Any one of these is proof; their absence means we do not claim it.
     */
    private function hasCodeIgniterMarkers(string $sandboxPath): bool
    {
        $sep = DIRECTORY_SEPARATOR;
        $system = $sandboxPath.$sep.'system'.$sep;

        return is_file($system.'core'.$sep.'CodeIgniter.php')
            || is_file($system.'core'.$sep.'Controller.php')
            || is_dir($system.'libraries')
            || is_dir($system.'helpers')
            || is_dir($system.'database');
    }
}
