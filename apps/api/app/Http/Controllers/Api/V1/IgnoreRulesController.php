<?php

namespace App\Http\Controllers\Api\V1;

use App\Support\Sandbox\IgnoreRules;
use Illuminate\Http\JsonResponse;

/**
 * DX-25: single source of truth for path-ignore rules.
 *
 * GET /api/v1/ignore-rules returns the full list the API uses during zip
 * extraction / local-folder indexing. The web frontend fetches this once and
 * uses it for client-side filtering — eliminating the drift between
 * config/sandbox.php and the frontend's ignoreRules.ts hardcode.
 *
 * Per-stack overlays (extra dirs for CI3 vs Laravel) are returned in a
 * separate `stackOverlays` map so the frontend can merge them when it knows
 * the active stack from the UsageReport.
 */
class IgnoreRulesController extends Controller
{
    public function __construct(
        private readonly IgnoreRules $rules,
    ) {}

    public function __invoke(): JsonResponse
    {
        return $this->respond([
            'dirs' => $this->rules->dirs(),
            'stackOverlays' => $this->stackOverlays(),
        ]);
    }

    /**
     * Per-stack directory ignore overlays.
     * These are additive: the web merges them with the base list when
     * the detected framework matches.
     *
     * @return array<string, list<string>>
     */
    private function stackOverlays(): array
    {
        return [
            'codeigniter-3' => ['cache', 'logs'],
            'laravel' => ['bootstrap/cache', 'storage'],
        ];
    }
}
