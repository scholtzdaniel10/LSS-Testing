<?php

namespace App\Services\Graph;

/**
 * IG-22: file-parser contract. One implementation per language/extension group.
 * Registering a new parser in DependencyGraphBuilder requires no runner edit.
 */
interface FileParser
{
    /**
     * Return the file extensions this parser handles (lowercase, no dot).
     *
     * @return list<string>
     */
    public function extensions(): array;

    /**
     * Extract dependency edges from the source of a single file.
     *
     * @return list<array<string, mixed>>
     */
    public function parse(string $relativePath, string $source): array;
}
