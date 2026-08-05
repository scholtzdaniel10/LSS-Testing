<?php

namespace App\Services\Import;

/**
 * DX-21: centralised stack-detection logic.
 *
 * Previously the CodeIgniter 3 check ($isCi3) was duplicated in both
 * UsageReportBuilder and PhpStanAdapter. This class is the single source of
 * truth; both consumers receive a StackProfile.
 *
 * DX-31: application/ + system/ + no composer.json is a directory-layout
 * coincidence, not proof of CodeIgniter — hand-rolled PHP apps can use the
 * same folder names. That layout alone still drives PHPStan's scan strategy
 * (isLegacyPhpLayout: no autoloader to bootstrap against), but reporting the
 * framework as "codeigniter-3" (isCi3) requires a positive marker from the
 * actual CodeIgniter 3 bootstrap file.
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

        $isLegacyPhpLayout = is_dir($sandboxPath.$sep.'application')
            && is_dir($sandboxPath.$sep.'system')
            && ! $hasComposer;

        $isCi3 = $isLegacyPhpLayout && $this->hasCi3Marker($sandboxPath, $sep);

        return new StackProfile(
            isLegacyPhpLayout: $isLegacyPhpLayout,
            isCi3: $isCi3,
            hasComposer: $hasComposer,
            hasPackage: $hasPackage,
            hasAngular: $hasAngular,
            hasPlaywright: $hasPlaywright,
        );
    }

    /**
     * Positive evidence of CodeIgniter 3: the real framework bootstrap file,
     * containing the CI_VERSION constant it defines. A hand-rolled app that
     * merely reuses the application/system folder names won't have this.
     */
    private function hasCi3Marker(string $sandboxPath, string $sep): bool
    {
        $bootstrap = $sandboxPath.$sep.'system'.$sep.'core'.$sep.'CodeIgniter.php';

        return is_file($bootstrap)
            && str_contains((string) file_get_contents($bootstrap), 'CI_VERSION');
    }
}
