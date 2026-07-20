<?php

/*
 * HD-4: health scoring formula. Weights and penalties are config, not code —
 * tuning the formula must never require a deploy. Every score the formula
 * yields is traceable to the metrics in the same C2 snapshot (vault note 02,
 * anti-snake-oil rule); the formula string is surfaced in API meta.
 */
return [
    // Dimension weights for the overall score (must sum to 1.0).
    'weights' => [
        'errors' => 0.35,
        'dependencies' => 0.25,
        'tests' => 0.20,
        'structure' => 0.20,
    ],

    // Errors: penalty per finding, per 100 analysed files (density-based so
    // big programs aren't punished for being big).
    'error_penalties' => [
        'error' => 8.0,
        'warning' => 2.0,
        'info' => 0.5,
    ],

    // Dependencies: flat penalty per issue.
    'dependency_penalties' => [
        'missing_dep' => 15,
        'undeclared_env_var' => 8,
        'outdated_dep' => 2,
    ],

    // Structure: penalty per hotspot file above the centrality×density bar.
    'structure' => [
        'hotspot_penalty' => 12,
        'hotspot_threshold' => 0.15, // centrality * errorDensity above this = hotspot
        'max_hotspots' => 5,
    ],

    // Human-readable formula, returned as API meta so the dashboard can show
    // its work (HD-4 acceptance criterion).
    'formula' => 'overall = 0.35*errors + 0.25*dependencies + 0.20*tests + 0.20*structure; '
        .'errors = 100 - (8*error + 2*warning + 0.5*info) per 100 files; '
        .'dependencies = 100 - 15*missing - 8*undeclaredEnv - 2*outdated; '
        .'tests = passRate*100 (0 when no tests exist); '
        .'structure = 100 - 12*hotspot (centrality*errorDensity > 0.15); all clamped 0..100',
];
