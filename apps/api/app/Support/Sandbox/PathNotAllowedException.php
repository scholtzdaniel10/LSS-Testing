<?php

namespace App\Support\Sandbox;

use InvalidArgumentException;

/**
 * DSK-7 — thrown when a local path is not under any consented root
 * (neither a DB-registered LocalRoot nor an env-configured prefix).
 *
 * Carries a stable, machine-readable code so the web client can
 * detect this specific failure and offer the in-app consent flow
 * without depending on English message text.
 */
final class PathNotAllowedException extends InvalidArgumentException
{
    /** Stable code surfaced in the RFC-7807 problem envelope. */
    public const CODE = 'path_not_allowed';

    public function __construct(
        string $message,
        public readonly string $rejectedPath,
    ) {
        parent::__construct($message);
    }
}
