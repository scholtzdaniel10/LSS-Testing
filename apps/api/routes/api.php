<?php

use App\Http\Controllers\Api\V1\ErrorController;
use App\Http\Controllers\Api\V1\GraphController;
use App\Http\Controllers\Api\V1\HealthController;
use App\Http\Controllers\Api\V1\HealthReportController;
use App\Http\Controllers\Api\V1\JobStatusController;
use App\Http\Controllers\Api\V1\ProjectController;
use App\Http\Controllers\Api\V1\SnapshotController;
use App\Http\Controllers\Api\V1\UsageReportController;
use Illuminate\Support\Facades\Route;

// Contract C7: all routes live under /api/v1; health is the only
// unauthenticated endpoint. Response envelope: { data, meta, errors }.
Route::prefix('v1')->middleware('throttle:api')->group(function () {
    Route::get('/health', HealthController::class);

    Route::middleware('auth:sanctum')->group(function () {
        Route::get('/projects', [ProjectController::class, 'index']);
        Route::get('/projects/{project}', [ProjectController::class, 'show']);
        Route::get('/projects/{project}/health-report', [HealthReportController::class, 'show']);
        Route::get('/projects/{project}/health-report/history', [HealthReportController::class, 'history']);
        Route::get('/projects/{project}/graph', [GraphController::class, 'show']);
        Route::get('/projects/{project}/usage-report', [UsageReportController::class, 'show']);
        Route::get('/projects/{project}/errors', [ErrorController::class, 'index']);
        Route::get('/jobs/{jobStatus}', [JobStatusController::class, 'show']);

        Route::post('/projects/{project}/snapshot', [SnapshotController::class, 'store'])
            ->middleware('throttle:expensive');
    });
});
