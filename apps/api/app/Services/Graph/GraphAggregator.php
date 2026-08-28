<?php

namespace App\Services\Graph;

/**
 * Server-side graph overview: collapsed folder hubs plus a ranked file slice
 * so the client can paint an overview without downloading the full C3 blob.
 *
 * Ranking copies apps/web/src/lib/graphModel.ts (folderOf, isExternalRef,
 * collapse with expanded=∅ / showExternal=false, hugeGraphOverviewKeep).
 */
final class GraphAggregator
{
    private const FOLDER_PREFIX = 'dir:';

    /** @var list<string> */
    private const FOLDER_KEYS = [
        'app', 'application', 'routes', 'resources', 'database', 'src', 'system',
        'lib', 'components', 'pages', 'services',
    ];

    /**
     * @param  list<array{from?: mixed, to?: mixed, kind?: mixed, line?: mixed}>  $edges
     * @param  list<string>  $allFiles
     * @param  array<string, int>  $errorCounts
     * @return array{
     *     nodes: list<array<string, mixed>>,
     *     links: list<array{source: string, target: string, weight: int, externalTarget: bool}>,
     *     total: int,
     *     returned: int,
     *     truncated: bool,
     *     cap: int
     * }
     */
    public function overview(array $edges, array $allFiles, array $errorCounts, int $fileCap): array
    {
        $fileCap = max(0, $fileCap);

        $collapsed = $this->buildCollapsed($edges, $allFiles, $errorCounts);
        $files = $this->buildFileLevel($edges, $allFiles, $errorCounts);

        $uncapped = [];
        foreach ($collapsed as $id => $node) {
            if ($node['kind'] === 'folder') {
                $uncapped[$id] = $node;
            }
        }
        foreach ($files as $id => $node) {
            $uncapped[$id] = $node;
        }

        $keep = $this->overviewKeep($uncapped, $fileCap);

        $droppedFiles = false;
        foreach ($files as $id => $node) {
            if ($node['kind'] === 'file' && ! isset($keep[$id])) {
                $droppedFiles = true;
                break;
            }
        }

        $nodes = [];
        foreach ($uncapped as $id => $node) {
            if (! isset($keep[$id])) {
                continue;
            }
            $nodes[] = $this->serializeNode($node);
        }

        $links = $this->overviewLinks($edges, $keep, $uncapped);

        return [
            'nodes' => $nodes,
            'links' => $links,
            'total' => count($uncapped),
            'returned' => count($nodes),
            'truncated' => $droppedFiles,
            'cap' => $fileCap,
        ];
    }

    public static function folderOf(string $path): string
    {
        $top = explode('/', $path)[0] ?? 'other';
        if ($top !== '' && in_array($top, self::FOLDER_KEYS, true)) {
            return $top;
        }

        return 'other';
    }

    public static function isExternalRef(string $id): bool
    {
        return str_starts_with($id, 'pkg:')
            || str_starts_with($id, 'php:')
            || str_starts_with($id, 'npm:')
            || str_starts_with($id, 'ext:');
    }

    /**
     * @param  list<array{from?: mixed, to?: mixed, kind?: mixed, line?: mixed}>  $edges
     * @param  list<string>  $allFiles
     * @param  array<string, int>  $errorCounts
     * @return array<string, array<string, mixed>>
     */
    private function buildCollapsed(array $edges, array $allFiles, array $errorCounts): array
    {
        $nodes = [];

        foreach ($allFiles as $path) {
            $target = $this->collapseFile((string) $path);
            if ($target['kind'] === 'folder') {
                $folder = $this->ensureFolder($nodes, $target['folderPath']);
                $folder['fileCount']++;
                $folder['errors'] += $errorCounts[$path] ?? 0;
                $nodes[$folder['id']] = $folder;
            } else {
                $this->ensureFile($nodes, (string) $path, $errorCounts);
            }
        }

        $linkWeights = [];
        foreach ($this->internalEdges($edges) as [$from, $to]) {
            $src = $this->mapCollapsedEndpoint($nodes, $from, $errorCounts);
            $tgt = $this->mapCollapsedEndpoint($nodes, $to, $errorCounts);
            if ($src === $tgt) {
                continue;
            }
            $key = $src.' '.$tgt;
            if (! isset($linkWeights[$key])) {
                $linkWeights[$key] = [
                    'source' => $src,
                    'target' => $tgt,
                    'weight' => 0,
                ];
            }
            $linkWeights[$key]['weight']++;
        }

        $this->applyDegrees($nodes, $linkWeights);

        return $nodes;
    }

    /**
     * @param  list<array{from?: mixed, to?: mixed, kind?: mixed, line?: mixed}>  $edges
     * @param  list<string>  $allFiles
     * @param  array<string, int>  $errorCounts
     * @return array<string, array<string, mixed>>
     */
    private function buildFileLevel(array $edges, array $allFiles, array $errorCounts): array
    {
        $nodes = [];
        foreach ($allFiles as $path) {
            $this->ensureFile($nodes, (string) $path, $errorCounts);
        }

        $linkWeights = [];
        foreach ($this->internalEdges($edges) as [$from, $to]) {
            $src = $this->ensureFile($nodes, $from, $errorCounts);
            $tgt = $this->ensureFile($nodes, $to, $errorCounts);
            if ($src['id'] === $tgt['id']) {
                continue;
            }
            $key = $src['id'].' '.$tgt['id'];
            if (! isset($linkWeights[$key])) {
                $linkWeights[$key] = [
                    'source' => $src['id'],
                    'target' => $tgt['id'],
                    'weight' => 0,
                ];
            }
            $linkWeights[$key]['weight']++;
        }

        $this->applyDegrees($nodes, $linkWeights);

        return $nodes;
    }

    /**
     * @param  array<string, array<string, mixed>>  $nodes
     * @return array<string, true>
     */
    private function overviewKeep(array $nodes, int $fileCap): array
    {
        $keep = [];
        $ranked = [];

        foreach ($nodes as $node) {
            if ($node['kind'] === 'folder' || $node['errors'] > 0 || $node['external'] === true) {
                $keep[$node['id']] = true;

                continue;
            }
            if ($node['kind'] === 'file') {
                $ranked[] = $node;
            }
        }

        usort($ranked, function (array $a, array $b): int {
            $deg = $b['degree'] <=> $a['degree'];
            if ($deg !== 0) {
                return $deg;
            }

            return strcmp((string) $a['id'], (string) $b['id']);
        });

        foreach (array_slice($ranked, 0, $fileCap) as $file) {
            $keep[$file['id']] = true;
        }

        return $keep;
    }

    /**
     * @param  list<array{from?: mixed, to?: mixed, kind?: mixed, line?: mixed}>  $edges
     * @param  array<string, true>  $keep
     * @param  array<string, array<string, mixed>>  $uncapped
     * @return list<array{source: string, target: string, weight: int, externalTarget: bool}>
     */
    private function overviewLinks(array $edges, array $keep, array $uncapped): array
    {
        $linkWeights = [];
        foreach ($this->internalEdges($edges) as [$from, $to]) {
            $src = isset($keep[$from]) ? $from : $this->collapseFile($from)['id'];
            $tgt = isset($keep[$to]) ? $to : $this->collapseFile($to)['id'];
            if ($src === $tgt || ! isset($keep[$src]) || ! isset($keep[$tgt])) {
                continue;
            }
            $key = $src.' '.$tgt;
            if (! isset($linkWeights[$key])) {
                $tgtNode = $uncapped[$tgt] ?? null;
                $linkWeights[$key] = [
                    'source' => $src,
                    'target' => $tgt,
                    'weight' => 0,
                    'externalTarget' => ($tgtNode['kind'] ?? null) === 'external',
                ];
            }
            $linkWeights[$key]['weight']++;
        }

        return array_values($linkWeights);
    }

    /**
     * @param  list<array{from?: mixed, to?: mixed, kind?: mixed, line?: mixed}>  $edges
     * @return list<array{0: string, 1: string}>
     */
    private function internalEdges(array $edges): array
    {
        $out = [];
        foreach ($edges as $edge) {
            $from = is_string($edge['from'] ?? null) ? $edge['from'] : '';
            $to = is_string($edge['to'] ?? null) ? $edge['to'] : '';
            if ($from === '' || $to === '') {
                continue;
            }
            if (self::isExternalRef($from) || self::isExternalRef($to)) {
                continue;
            }
            $out[] = [$from, $to];
        }

        return $out;
    }

    /**
     * @return array{id: string, kind: 'file'|'folder', folderPath: string}
     */
    private function collapseFile(string $path): array
    {
        $parts = explode('/', $path);
        $acc = '';
        $limit = count($parts) - 1;
        for ($i = 0; $i < $limit; $i++) {
            $acc = $i === 0 ? $parts[$i] : $acc.'/'.$parts[$i];

            // expanded=∅ — first ancestor always wins.
            return [
                'id' => self::FOLDER_PREFIX.$acc,
                'kind' => 'folder',
                'folderPath' => $acc,
            ];
        }

        return ['id' => $path, 'kind' => 'file', 'folderPath' => ''];
    }

    /**
     * @param  array<string, array<string, mixed>>  $nodes
     * @param  array<string, int>  $errorCounts
     */
    private function mapCollapsedEndpoint(array &$nodes, string $id, array $errorCounts): string
    {
        $target = $this->collapseFile($id);
        if ($target['kind'] === 'folder') {
            return $this->ensureFolder($nodes, $target['folderPath'])['id'];
        }

        return $this->ensureFile($nodes, $id, $errorCounts)['id'];
    }

    /**
     * @param  array<string, array<string, mixed>>  $nodes
     * @return array<string, mixed>
     */
    private function ensureFolder(array &$nodes, string $folderPath): array
    {
        $id = self::FOLDER_PREFIX.$folderPath;
        if (! isset($nodes[$id])) {
            $parts = explode('/', $folderPath);
            $leaf = $parts[array_key_last($parts)] ?? $folderPath;
            $nodes[$id] = [
                'id' => $id,
                'name' => $leaf.'/',
                'kind' => 'folder',
                'folderPath' => $folderPath,
                'folder' => self::folderOf($folderPath),
                'external' => false,
                'errors' => 0,
                'inDegree' => 0,
                'degree' => 0,
                'fileCount' => 0,
            ];
        }

        return $nodes[$id];
    }

    /**
     * @param  array<string, array<string, mixed>>  $nodes
     * @param  array<string, int>  $errorCounts
     * @return array<string, mixed>
     */
    private function ensureFile(array &$nodes, string $path, array $errorCounts): array
    {
        if (! isset($nodes[$path])) {
            $parts = explode('/', $path);
            $leaf = $parts[array_key_last($parts)] ?? $path;
            $nodes[$path] = [
                'id' => $path,
                'name' => $leaf,
                'kind' => 'file',
                'folder' => self::folderOf($path),
                'external' => false,
                'errors' => $errorCounts[$path] ?? 0,
                'inDegree' => 0,
                'degree' => 0,
                'fileCount' => 1,
            ];
        }

        return $nodes[$path];
    }

    /**
     * @param  array<string, array<string, mixed>>  $nodes
     * @param  array<string, array{source: string, target: string, weight: int}>  $linkWeights
     */
    private function applyDegrees(array &$nodes, array $linkWeights): void
    {
        foreach ($linkWeights as $link) {
            $s = $link['source'];
            $t = $link['target'];
            if (isset($nodes[$s])) {
                $nodes[$s]['degree'] += $link['weight'];
            }
            if (isset($nodes[$t])) {
                $nodes[$t]['degree'] += $link['weight'];
                $nodes[$t]['inDegree'] += $link['weight'];
            }
        }
    }

    /**
     * @param  array<string, mixed>  $node
     * @return array<string, mixed>
     */
    private function serializeNode(array $node): array
    {
        $out = [
            'id' => $node['id'],
            'name' => $node['name'],
            'kind' => $node['kind'],
            'folder' => $node['folder'],
            'fileCount' => $node['fileCount'],
            'errors' => $node['errors'],
            'degree' => $node['degree'],
            'inDegree' => $node['inDegree'],
            'external' => $node['external'],
        ];
        if ($node['kind'] === 'folder') {
            $out['folderPath'] = $node['folderPath'];
        }

        return $out;
    }
}
