<?php

namespace App\Http\Middleware;

use App\Support\Api\ApiResponse;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * DSK-3 — Per-launch local-link session token guard.
 *
 * When LSS_LOCAL_LINK_TOKEN is set in the environment (populated by desktop.bat
 * at launch time), every request to a local-folder-linking surface must carry
 * the matching value in the X-LSS-Local-Token request header.
 *
 * If the config value is empty or null (e.g. a developer running
 * `php artisan serve` manually without going through desktop.bat), enforcement
 * is disabled and all requests pass through — local dev keeps working without
 * any extra setup.
 *
 * Comparison uses hash_equals() to prevent timing attacks.
 */
class RequireLocalLinkToken
{
    public function handle(Request $request, Closure $next): Response
    {
        $configured = config('sandbox.local_link_token');

        if (! is_string($configured) || $configured === '') {
            // Token not set — enforcement disabled (manual dev serve).
            return $next($request);
        }

        $provided = $request->header('X-LSS-Local-Token', '');

        if (! hash_equals($configured, (string) $provided)) {
            return ApiResponse::failure([
                ApiResponse::problem(
                    title: 'Invalid local-link token',
                    detail: 'The X-LSS-Local-Token header is missing or incorrect. Launch the application via desktop.bat to obtain a valid session token.',
                    status: 403,
                    instance: $request->getPathInfo(),
                    extensions: ['code' => 'local_link_token_invalid'],
                ),
            ], status: 403);
        }

        return $next($request);
    }
}
