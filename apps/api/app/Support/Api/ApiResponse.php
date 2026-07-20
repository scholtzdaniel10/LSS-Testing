<?php

namespace App\Support\Api;

use Illuminate\Contracts\Pagination\CursorPaginator;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Http\JsonResponse;

/**
 * Contract C7 response envelope: { data, meta, errors }.
 */
final class ApiResponse
{
    /**
     * @param  array<string, mixed>  $meta
     */
    public static function success(mixed $data, array $meta = [], int $status = 200): JsonResponse
    {
        return response()->json([
            'data' => $data,
            'meta' => array_merge(['version' => 'v1'], $meta),
            'errors' => [],
        ], $status);
    }

    /**
     * @param  array<string, mixed>  $meta
     */
    public static function paginated(LengthAwarePaginator $paginator, array $meta = []): JsonResponse
    {
        return self::success($paginator->items(), array_merge($meta, [
            'total' => $paginator->total(),
            'page' => $paginator->currentPage(),
            'per_page' => $paginator->perPage(),
            'last_page' => $paginator->lastPage(),
        ]));
    }

    /**
     * Keyset pagination for big tables (vault note 11, rule 4) — errors lists
     * must never use OFFSET. Cursors are opaque; clients follow nextCursor.
     *
     * @param  array<string, mixed>  $meta
     */
    public static function cursorPaginated(CursorPaginator $paginator, array $meta = []): JsonResponse
    {
        return self::success($paginator->items(), array_merge($meta, [
            'per_page' => $paginator->perPage(),
            'next_cursor' => $paginator->nextCursor()?->encode(),
            'prev_cursor' => $paginator->previousCursor()?->encode(),
        ]));
    }

    /**
     * @param  array<int, array<string, mixed>>  $errors
     * @param  array<string, mixed>  $meta
     */
    public static function failure(array $errors, array $meta = [], int $status = 400): JsonResponse
    {
        return response()->json([
            'data' => null,
            'meta' => array_merge(['version' => 'v1'], $meta),
            'errors' => $errors,
        ], $status);
    }

    /**
     * RFC-7807-style problem object for the errors[] array.
     *
     * @param  array<string, mixed>  $extensions
     * @return array<string, mixed>
     */
    public static function problem(
        string $title,
        string $detail,
        int $status,
        ?string $type = null,
        ?string $instance = null,
        array $extensions = [],
    ): array {
        return array_filter(array_merge([
            'type' => $type ?? 'about:blank',
            'title' => $title,
            'status' => $status,
            'detail' => $detail,
            'instance' => $instance,
        ], $extensions), static fn (mixed $value): bool => $value !== null);
    }
}
