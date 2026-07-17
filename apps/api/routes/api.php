<?php

use App\Http\Controllers\Api\V1\HealthController;
use App\Http\Controllers\Api\V1\HealthReportController;
use App\Http\Controllers\Api\V1\ProjectController;
use Illuminate\Support\Facades\Route;

// Contract C7: all routes live under /api/v1; health is the only
// unauthenticated endpoint. Response envelope: { data, meta, errors }.
Route::prefix('v1')->group(function () {
    Route::get('/health', HealthController::class);

    Route::get('/projects', [ProjectController::class, 'index']);
    Route::get('/projects/{project}', [ProjectController::class, 'show']);
    Route::get('/projects/{project}/health-report', [HealthReportController::class, 'show']);
    Route::get('/projects/{project}/health-report/history', [HealthReportController::class, 'history']);
});
