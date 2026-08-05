<?php

namespace App\Services\Import;

/**
 * DX-21: immutable value object describing a detected technology stack.
 * Produced by StackDetector; consumed by UsageReportBuilder and PhpStanAdapter.
 */
final class StackProfile
{
    public function __construct(
        /**
         * Whether the sandbox is *positively identified* as CodeIgniter 3 via
         * framework marker files. DX-31: never inferred from the
         * application/ + system/ layout alone — that layout is shared by
         * hand-rolled PHP frameworks and produced false positives. Used only
         * to name the framework in the usage report.
         */
        public readonly bool $isCi3,
        /**
         * Whether the sandbox uses the legacy `application/` + `system/` layout
         * with no Composer autoloader. DX-31: this — not $isCi3 — drives
         * PHPStan strategy (scanDirectories over paths, level 0, per-
         * application-dir sharding), because the analyser cares about the
         * missing autoloader, not the framework brand.
         */
        public readonly bool $isLegacyPhpLayout,
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
