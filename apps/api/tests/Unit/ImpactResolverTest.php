<?php

use App\Services\Diagnostics\ImpactResolver;

function chainEdges(): array
{
    // b depends on a, c on b, d on c, e on d — plus one unrelated pair.
    return [
        ['from' => 'b.php', 'to' => 'a.php', 'kind' => 'import', 'line' => 3],
        ['from' => 'c.php', 'to' => 'b.php', 'kind' => 'import', 'line' => 3],
        ['from' => 'd.php', 'to' => 'c.php', 'kind' => 'import', 'line' => 3],
        ['from' => 'e.php', 'to' => 'd.php', 'kind' => 'import', 'line' => 3],
        ['from' => 'x.php', 'to' => 'y.php', 'kind' => 'import', 'line' => 1],
    ];
}

it('resolves direct upstream dependencies (DX-7)', function () {
    $resolver = new ImpactResolver(chainEdges());

    expect($resolver->upstream('b.php'))->toBe(['a.php'])
        ->and($resolver->upstream('a.php'))->toBe([])
        ->and($resolver->upstream('d.php'))->toBe(['c.php']);
});

it('resolves transitive downstream dependents breadth-first (DX-7)', function () {
    $resolver = new ImpactResolver(chainEdges());

    // Golden expectation: exactly the 3 files within the default depth cap,
    // nearest hop first; e.php is 4 hops away and stays outside the cap.
    expect($resolver->downstream('a.php'))->toBe(['b.php', 'c.php', 'd.php'])
        ->and($resolver->downstream('d.php'))->toBe(['e.php'])
        ->and($resolver->downstream('e.php'))->toBe([]);
});

it('honours the depth cap (DX-7)', function () {
    $resolver = new ImpactResolver(chainEdges());

    expect($resolver->downstream('a.php', 1))->toBe(['b.php'])
        ->and($resolver->downstream('a.php', 2))->toBe(['b.php', 'c.php'])
        ->and($resolver->downstream('a.php', 4))->toBe(['b.php', 'c.php', 'd.php', 'e.php']);
});

it('returns empty lists for unknown files and never fabricates (DX-7)', function () {
    $resolver = new ImpactResolver(chainEdges());

    expect($resolver->upstream('nope.php'))->toBe([])
        ->and($resolver->downstream('nope.php'))->toBe([]);
});

it('normalises separators and dedupes cyclic edges (DX-7)', function () {
    $resolver = new ImpactResolver([
        ['from' => 'src\\b.php', 'to' => 'src/a.php', 'kind' => 'import', 'line' => 1],
        ['from' => 'src/b.php', 'to' => 'src/a.php', 'kind' => 'import', 'line' => 2],
        // cycle: a depends back on b — BFS must terminate and not repeat
        ['from' => 'src/a.php', 'to' => 'src/b.php', 'kind' => 'import', 'line' => 5],
    ]);

    expect($resolver->upstream('src/b.php'))->toBe(['src/a.php'])
        ->and($resolver->downstream('src/a.php'))->toBe(['src/b.php']);
});
