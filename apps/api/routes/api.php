<?php

use Illuminate\Support\Facades\Route;

// Contract C7: all routes live under /api/v1; health is the only
// unauthenticated endpoint. Response envelope: { data, meta, errors }.
Route::prefix('v1')->group(function () {
    Route::get('/health', function () {
        return response()->json([
            'data' => [
                'status' => 'ok',
                'time' => now()->toIso8601String(),
            ],
            'meta' => ['version' => 'v1'],
            'errors' => [],
        ]);
    });
});
