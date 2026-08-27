<?php

namespace App\Services\Graph;

use App\Support\Contracts\ContractDocuments;
use App\Support\Sandbox\IgnoreRules;

/**
 * IG-8/9/10/22: extract file-level import/require edges from project source.
 *
 * IG-22: language dispatch is driven by a FileParser registry — adding support
 * for a new language requires only registering a new FileParser; this class
 * needs no edit. The match($ext) hardcode is gone.
 *
 * Emits C3 edges; symbol omitted when unknown (file-level fallback).
 */
final class DependencyGraphBuilder
{
    private const MAX_FILES = 4000;

    /** @var array<string, FileParser> keyed by lowercase extension */
    private array $parserByExt = [];

    /**
     * @param  list<FileParser>  $parsers  If empty, defaults to PHP + JS + HTML.
     */
    public function __construct(
        private readonly IgnoreRules $ignore,
        array $parsers = [],
    ) {
        $defaults = $parsers !== [] ? $parsers : [
            new PhpFileParser,
            new JsFileParser,
            new HtmlFileParser,
        ];
        foreach ($defaults as $parser) {
            foreach ($parser->extensions() as $ext) {
                $this->parserByExt[strtolower($ext)] = $parser;
            }
        }
    }

    /**
     * Register an additional FileParser. Overwrites if extension already mapped.
     * IG-22: adding a parser needs no runner edit.
     */
    public function registerParser(FileParser $parser): void
    {
        foreach ($parser->extensions() as $ext) {
            $this->parserByExt[strtolower($ext)] = $parser;
        }
    }

    /**
     * Extensions registered for parsing (lowercase).
     *
     * @return list<string>
     */
    public function parseableExtensions(): array
    {
        return array_values(array_keys($this->parserByExt));
    }

    /**
     * project_files.lang values that map to a registered parser.
     *
     * @return list<string>
     */
    public function parseableLangs(): array
    {
        $langs = [];
        foreach ($this->parseableExtensions() as $ext) {
            $langs[] = match ($ext) {
                'php' => 'php',
                'js', 'jsx', 'mjs', 'cjs' => 'javascript',
                'ts', 'tsx' => 'typescript',
                'html', 'htm' => 'html',
                default => $ext,
            };
        }

        return array_values(array_unique($langs));
    }

    /**
     * Walk the sandbox tree (legacy zip imports). Prefer {@see buildIndexed} when file list exists.
     *
     * @return list<array<string, mixed>>
     */
    public function build(string $sandboxPath): array
    {
        $paths = [];
        $iterator = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($sandboxPath, \FilesystemIterator::SKIP_DOTS),
        );

        foreach ($iterator as $file) {
            if (! $file->isFile()) {
                continue;
            }
            $relative = ltrim(str_replace('\\', '/', substr($file->getPathname(), strlen(rtrim($sandboxPath, '\\/')))), '/');
            if ($this->ignore->shouldSkip($relative)) {
                continue;
            }
            $paths[] = $relative;
            if (count($paths) >= self::MAX_FILES) {
                break;
            }
        }

        return $this->buildIndexed($sandboxPath, $paths);
    }

    /**
     * Scan only known project files (fast path for local-linked large trees).
     *
     * @param  list<string>  $relativePaths
     * @return list<array<string, mixed>>
     */
    public function buildIndexed(string $sandboxPath, array $relativePaths): array
    {
        $edges = [];
        $root = rtrim(str_replace('\\', '/', $sandboxPath), '/');
        $count = 0;

        foreach ($relativePaths as $relative) {
            $relative = ltrim(str_replace('\\', '/', $relative), '/');
            if ($relative === '' || $this->ignore->shouldSkip($relative)) {
                continue;
            }

            $ext = strtolower(pathinfo($relative, PATHINFO_EXTENSION));

            // IG-22: registry dispatch — no match($ext) hardcode
            $parser = $this->parserByExt[$ext] ?? null;
            if ($parser === null) {
                continue;
            }

            if (++$count > self::MAX_FILES) {
                break;
            }

            $absolute = $root.'/'.$relative;
            if (! is_file($absolute)) {
                continue;
            }

            $source = @file_get_contents($absolute);
            if ($source === false || strlen($source) > 512_000) {
                continue;
            }

            foreach ($parser->parse($relative, $source) as $edge) {
                $edges[] = ContractDocuments::edge($edge);
            }
        }

        return $edges;
    }
}
