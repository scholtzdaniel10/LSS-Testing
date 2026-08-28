<?php

namespace App\Services\Graph;

/**
 * IG-29: server-side graph overview so the client can paint an overview
 * without downloading the full C3 blob.
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

        $keep = self::hugeGraphOverviewKeep(array_values($uncapped), $fileCap);

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

    /**
     * IG-29: folder-only rollup. depth=1 is the first path segment (same
     * collapse as buildGraphView with expanded=∅). Root-level files (no
     * slash) are omitted. showExternal=false.
     *
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
    public function rollup(array $edges, array $allFiles, array $errorCounts, int $depth): array
    {
        $depth = max(1, min(4, $depth));
        $max = max(1, (int) config('graph.aggregate_max_nodes', 200));

        $nodes = [];
        foreach ($allFiles as $path) {
            $folderPath = $this->folderPathAtDepth((string) $path, $depth);
            if ($folderPath === null) {
                continue;
            }
            $folder = $this->ensureFolder($nodes, $folderPath);
            $folder['fileCount']++;
            $folder['errors'] += $errorCounts[$path] ?? 0;
            $nodes[$folder['id']] = $folder;
        }

        $linkWeights = [];
        foreach ($this->internalEdges($edges) as [$from, $to]) {
            $srcPath = $this->folderPathAtDepth($from, $depth);
            $tgtPath = $this->folderPathAtDepth($to, $depth);
            if ($srcPath === null || $tgtPath === null || $srcPath === $tgtPath) {
                continue;
            }
            $src = $this->ensureFolder($nodes, $srcPath);
            $tgt = $this->ensureFolder($nodes, $tgtPath);
            $key = $src['id'].' '.$tgt['id'];
            if (! isset($linkWeights[$key])) {
                $linkWeights[$key] = [
                    'source' => $src['id'],
                    'target' => $tgt['id'],
                    'weight' => 0,
                    'externalTarget' => false,
                ];
            }
            $linkWeights[$key]['weight']++;
        }

        $this->applyDegrees($nodes, $linkWeights);

        $total = count($nodes);
        $truncated = $total > $max;
        if ($truncated) {
            $ranked = array_values($nodes);
            usort($ranked, function (array $a, array $b): int {
                $byCount = $b['fileCount'] <=> $a['fileCount'];
                if ($byCount !== 0) {
                    return $byCount;
                }
                $byErrors = $b['errors'] <=> $a['errors'];
                if ($byErrors !== 0) {
                    return $byErrors;
                }

                return strcmp((string) $a['id'], (string) $b['id']);
            });
            $keep = [];
            foreach (array_slice($ranked, 0, $max) as $node) {
                $keep[$node['id']] = true;
            }
            $nodes = array_filter($nodes, fn (array $node): bool => isset($keep[$node['id']]));
            $linkWeights = array_filter(
                $linkWeights,
                fn (array $link): bool => isset($keep[$link['source']]) && isset($keep[$link['target']]),
            );
        }

        $serialized = [];
        foreach ($nodes as $node) {
            $serialized[] = $this->serializeNode($node);
        }

        return [
            'nodes' => array_values($serialized),
            'links' => array_values($linkWeights),
            'total' => $total,
            'returned' => count($serialized),
            'truncated' => $truncated,
            'cap' => $depth,
        ];
    }

    /**
     * IG-33: N-hop file neighbourhood of a folder hub or file node.
     * Mirrors neighbourhoodWithin + cappedNeighbourhood (hops 1–3, rank
     * errors then degree then id). showExternal=false. Folder focus seeds
     * every file under that path; hops are then walked on the file graph.
     *
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
    public function neighbourhood(array $edges, array $allFiles, array $errorCounts, string $focus, int $radius): array
    {
        $radius = max(1, min(3, $radius));
        $max = max(1, (int) config('graph.aggregate_max_nodes', 200));

        $files = $this->buildFileLevel($edges, $allFiles, $errorCounts);
        $adj = $this->undirectedAdjacency($edges);
        $roots = $this->resolveFocus($focus, $allFiles, $files);

        if ($roots === []) {
            return [
                'nodes' => [],
                'links' => [],
                'total' => 0,
                'returned' => 0,
                'truncated' => false,
                'cap' => $max,
            ];
        }

        $visible = $this->walkNeighbourhood($roots, $adj, $radius);
        $total = count($visible);
        $truncated = $total > $max;
        $keep = $truncated
            ? $this->capNeighbourhood($visible, $roots, $files, $max)
            : $visible;

        $nodes = [];
        foreach ($keep as $id => $_) {
            if (! isset($files[$id])) {
                $this->ensureFile($files, $id, $errorCounts);
            }
            $nodes[] = $this->serializeNode($files[$id]);
        }

        $links = $this->neighbourhoodLinks($edges, $keep);

        return [
            'nodes' => $nodes,
            'links' => $links,
            'total' => $total,
            'returned' => count($nodes),
            'truncated' => $truncated,
            'cap' => $max,
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
     * Port of hugeGraphOverviewKeep in apps/web/src/lib/graphModel.ts.
     * Always keeps folder hubs, error files, and externals; then the top
     * $fileCap files by degree desc, id strcmp. Not a total node cap.
     *
     * @param  list<array{id: string, kind: string, errors: int, external: bool, degree?: int}>  $nodes
     * @return array<string, true>
     */
    public static function hugeGraphOverviewKeep(array $nodes, int $fileCap = 40): array
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
            $deg = ($b['degree'] ?? 0) <=> ($a['degree'] ?? 0);
            if ($deg !== 0) {
                return $deg;
            }

            return strcmp((string) $a['id'], (string) $b['id']);
        });

        foreach (array_slice($ranked, 0, max(0, $fileCap)) as $file) {
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
     * @param  list<string>  $allFiles
     * @param  array<string, array<string, mixed>>  $files
     * @return list<string>
     */
    private function resolveFocus(string $focus, array $allFiles, array $files): array
    {
        $focus = trim($focus);
        $focus = rtrim($focus, '/');
        if ($focus === '') {
            return [];
        }

        if (str_starts_with($focus, self::FOLDER_PREFIX)) {
            $folder = substr($focus, strlen(self::FOLDER_PREFIX));

            return $this->filesInFolder($folder, $allFiles);
        }

        if (isset($files[$focus]) || in_array($focus, $allFiles, true)) {
            return [$focus];
        }

        $under = $this->filesInFolder($focus, $allFiles);
        if ($under !== []) {
            return $under;
        }

        return [];
    }

    /**
     * @param  list<string>  $allFiles
     * @return list<string>
     */
    private function filesInFolder(string $folder, array $allFiles): array
    {
        if ($folder === '') {
            return [];
        }
        $prefix = $folder.'/';
        $out = [];
        foreach ($allFiles as $path) {
            $path = (string) $path;
            if ($path === $folder || str_starts_with($path, $prefix)) {
                $out[] = $path;
            }
        }

        return $out;
    }

    /**
     * Undirected adjacency of internal file edges. Mirrors buildNeighbourMap.
     *
     * @param  list<array{from?: mixed, to?: mixed, kind?: mixed, line?: mixed}>  $edges
     * @return array<string, list<string>>
     */
    private function undirectedAdjacency(array $edges): array
    {
        $adj = [];
        foreach ($this->internalEdges($edges) as [$from, $to]) {
            if ($from === $to) {
                continue;
            }
            $adj[$from][] = $to;
            $adj[$to][] = $from;
        }

        return $adj;
    }

    /**
     * Multi-source BFS. Hops clamped 1–3. Roots included. Mirrors neighbourhoodWithin.
     *
     * @param  list<string>  $roots
     * @param  array<string, list<string>>  $adj
     * @return array<string, true>
     */
    private function walkNeighbourhood(array $roots, array $adj, int $radius): array
    {
        $visible = [];
        $frontier = [];
        foreach ($roots as $root) {
            $visible[$root] = true;
            $frontier[] = $root;
        }
        $hops = max(1, min(3, $radius));
        for ($d = 0; $d < $hops; $d++) {
            $next = [];
            foreach ($frontier as $id) {
                foreach ($adj[$id] ?? [] as $neighbour) {
                    if (isset($visible[$neighbour])) {
                        continue;
                    }
                    $visible[$neighbour] = true;
                    $next[] = $neighbour;
                }
            }
            $frontier = $next;
            if ($frontier === []) {
                break;
            }
        }

        return $visible;
    }

    /**
     * Keep every focus root that fits, then highest-error / highest-degree
     * neighbours. Mirrors cappedNeighbourhood.
     *
     * @param  array<string, true>  $visible
     * @param  list<string>  $roots
     * @param  array<string, array<string, mixed>>  $files
     * @return array<string, true>
     */
    private function capNeighbourhood(array $visible, array $roots, array $files, int $max): array
    {
        $rootSet = [];
        foreach ($roots as $root) {
            if (isset($visible[$root])) {
                $rootSet[$root] = true;
            }
        }
        $others = [];
        foreach ($visible as $id => $_) {
            if (! isset($rootSet[$id])) {
                $others[] = $id;
            }
        }

        $rank = function (string $a, string $b) use ($files): int {
            $na = $files[$a] ?? ['errors' => 0, 'degree' => 0];
            $nb = $files[$b] ?? ['errors' => 0, 'degree' => 0];
            $byErrors = ($nb['errors'] ?? 0) <=> ($na['errors'] ?? 0);
            if ($byErrors !== 0) {
                return $byErrors;
            }
            $byDegree = ($nb['degree'] ?? 0) <=> ($na['degree'] ?? 0);
            if ($byDegree !== 0) {
                return $byDegree;
            }

            return strcmp($a, $b);
        };

        $rootIds = array_keys($rootSet);
        usort($rootIds, $rank);
        usort($others, $rank);

        $keep = [];
        foreach (array_merge($rootIds, $others) as $id) {
            if (count($keep) >= $max) {
                break;
            }
            $keep[$id] = true;
        }

        return $keep;
    }

    /**
     * @param  list<array{from?: mixed, to?: mixed, kind?: mixed, line?: mixed}>  $edges
     * @param  array<string, true>  $keep
     * @return list<array{source: string, target: string, weight: int, externalTarget: bool}>
     */
    private function neighbourhoodLinks(array $edges, array $keep): array
    {
        $linkWeights = [];
        foreach ($this->internalEdges($edges) as [$from, $to]) {
            if ($from === $to || ! isset($keep[$from]) || ! isset($keep[$to])) {
                continue;
            }
            $key = $from.' '.$to;
            if (! isset($linkWeights[$key])) {
                $linkWeights[$key] = [
                    'source' => $from,
                    'target' => $to,
                    'weight' => 0,
                    'externalTarget' => false,
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
     * First $depth folder segments of $path, or null for a root-level file.
     */
    private function folderPathAtDepth(string $path, int $depth): ?string
    {
        $parts = explode('/', $path);
        if (count($parts) < 2) {
            return null;
        }
        $folderParts = array_slice($parts, 0, -1);
        $take = min($depth, count($folderParts));

        return implode('/', array_slice($folderParts, 0, $take));
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
