<?php

namespace App\Services\Import;

/**
 * DX-21: immutable value object describing a detected technology stack.
 * Produced by StackDetector; consumed by UsageReportBuilder and PhpStanAdapter.
 */
final class StackProfile
{
    public function __construct(
        /** application/ + system/ dirs with no Composer autoloader (layout only, not a framework claim). */
        public readonly bool $isLegacyPhpLayout,
        /** Whether the sandbox has a verified CodeIgniter 3 marker (DX-31: not just layout). */
        public readonly bool $isCi3,
        /** Whether a composer.json exists. */
        public readonly bool $hasComposer,
        /** Whether a package.json exists. */
        public readonly bool $hasPackage,
        /** Whether an angular.json exists. */
        public readonly bool $hasAngular,
        /** Whether a Playwright config exists. */
        public readonly bool $hasPlaywright,
    ) {}
}
