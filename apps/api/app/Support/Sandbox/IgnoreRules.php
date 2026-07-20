<?php

namespace App\Support\Sandbox;

/**
 * Server-side mirror of IG-17 client ignore rules for zip extraction safety.
 */
final class IgnoreRules
{
    /** @param list<string> $dirs */
    public function __construct(
        private readonly array $dirs,
    ) {}

    public static function fromConfig(): self
    {
        /** @var list<string> $dirs */
        $dirs = array_values(array_map('strval', config('sandbox.ignore_dirs', [])));

        return new self($dirs);
    }

    public function shouldSkip(string $relativePath): bool
    {
        $normalized = str_replace('\\', '/', $relativePath);
        $segments = explode('/', $normalized);

        foreach ($segments as $segment) {
            if ($segment !== '' && in_array($segment, $this->dirs, true)) {
                return true;
            }
        }

        return false;
    }

    /** @return list<string> */
    public function dirs(): array
    {
        return $this->dirs;
    }
}
