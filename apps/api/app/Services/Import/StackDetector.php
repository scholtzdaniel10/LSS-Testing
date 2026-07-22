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

        $hasComposer  = is_file($sandboxPath.$sep.'composer.json');
        $hasPackage   = is_file($sandboxPath.$sep.'package.json');
        $hasAngular   = is_file($sandboxPath.$sep.'angular.json');
        $hasPlaywright = is_file($sandboxPath.$sep.'playwright.config.ts')
            || is_file($sandboxPath.$sep.'playwright.config.js');

        // CodeIgniter 3: has application/ + system/ directories but no composer.json.
        $isCi3 = is_dir($sandboxPath.$sep.'application')
            && is_dir($sandboxPath.$sep.'system')
            && ! $hasComposer;

        return new StackProfile(
            isCi3: $isCi3,
            hasComposer: $hasComposer,
            hasPackage: $hasPackage,
            hasAngular: $hasAngular,
            hasPlaywright: $hasPlaywright,
        );
    }
}
