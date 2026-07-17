<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller as BaseController;
use App\Support\Api\ApiResponse;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Http\JsonResponse;

abstract class Controller extends BaseController
{
    /**
     * @param  array<string, mixed>  $meta
     */
    protected function respond(mixed $data, array $meta = [], int $status = 200): JsonResponse
    {
        return ApiResponse::success($data, $meta, $status);
    }

    /**
     * @param  array<string, mixed>  $meta
     */
    protected function respondPaginated(LengthAwarePaginator $paginator, array $meta = []): JsonResponse
    {
        return ApiResponse::paginated($paginator, $meta);
    }
}
