<?php

namespace App\Http\Controllers\Api\V1;

use Illuminate\Http\JsonResponse;

class HealthController extends Controller
{
    public function __invoke(): JsonResponse
    {
        return $this->respond([
            'status' => 'ok',
            'time' => now()->toIso8601String(),
        ]);
    }
}
