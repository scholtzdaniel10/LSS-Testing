<?php

use App\Http\Controllers\Api\V1\AnalyzeController;
use App\Http\Controllers\Api\V1\BootstrapController;
use App\Http\Controllers\Api\V1\ErrorController;
use App\Http\Controllers\Api\V1\GraphAggregateController;
use App\Http\Controllers\Api\V1\GraphController;
use App\Http\Controllers\Api\V1\HealthController;
use App\Http\Controllers\Api\V1\HealthReportController;
use App\Http\Controllers\Api\V1\IgnoreRulesController;
use App\Http\Controllers\Api\V1\JobStatusController;
use App\Http\Controllers\Api\V1\JobStreamController;
use App\Http\Controllers\Api\V1\LocalRootController;
use App\Http\Controllers\Api\V1\ProjectController;
use App\Http\Controllers\Api\V1\ProjectFileController;
use App\Http\Controllers\Api\V1\SnapshotController;
use App\Http\Controllers\Api\V1\TargetEnvironmentController;
use App\Http\Controllers\Api\V1\UsageReportController;
use Illuminate\Support\Facades\Route;

// Contract C7: all routes live under /api/v1; health is the only
// unauthenticated endpoint. Response envelope: { data, meta, errors }.
Route::prefix('v1')->middleware('throttle:api')->group(function () {
    Route::get('/health', HealthController::class);
    // DX-25: unauthenticated — ignore rules are not sensitive; the web fetches
    // them before a token is configured so it can filter the local file tree.
    Route::get('/ignore-rules', IgnoreRulesController::class);

    Route::middleware('auth:sanctum')->group(function () {
        Route::get('/projects', [ProjectController::class, 'index']);
        Route::post('/projects', [ProjectController::class, 'store']);
        Route::get('/projects/{project}', [ProjectController::class, 'show']);
        Route::delete('/projects/{project}', [ProjectController::class, 'destroy']);
        Route::post('/projects/{project}/import', [ProjectController::class, 'import'])
            ->middleware('throttle:expensive');

        // DSK-3: local-folder-linking surface — requires per-launch session token.
        Route::post('/projects/{project}/link-local', [ProjectController::class, 'linkLocal'])
            ->middleware(['throttle:expensive', 'local.token']);

        Route::get('/projects/{project}/tree', [ProjectFileController::class, 'tree']);
        Route::get('/projects/{project}/file', [ProjectFileController::class, 'show']);

        Route::get('/projects/{project}/health-report', [HealthReportController::class, 'show']);
        Route::get('/projects/{project}/health-report/history', [HealthReportController::class, 'history']);
        Route::get('/projects/{project}/graph', [GraphController::class, 'show']);
        // IG-29: ranked overview slice — does not replace GET /graph.
        Route::get('/projects/{project}/graph/overview', [GraphAggregateController::class, 'overview']);
        Route::get('/projects/{project}/graph/rollup', [GraphAggregateController::class, 'rollup']);
        Route::get('/projects/{project}/graph/neighbourhood', [GraphAggregateController::class, 'neighbourhood']);
        Route::get('/projects/{project}/usage-report', [UsageReportController::class, 'show']);
        Route::get('/projects/{project}/errors', [ErrorController::class, 'index']);
        Route::get('/projects/{project}/bootstrap', [BootstrapController::class, 'show']);

        Route::get('/projects/{project}/target-environments', [TargetEnvironmentController::class, 'index']);
        Route::post('/projects/{project}/target-environments', [TargetEnvironmentController::class, 'store']);
        Route::delete('/projects/{project}/target-environments/{targetEnvironment}', [TargetEnvironmentController::class, 'destroy']);
        Route::post('/projects/{project}/target-environments/{targetEnvironment}/probe', [TargetEnvironmentController::class, 'probe']);

        Route::get('/jobs/{jobStatus}', [JobStatusController::class, 'show']);
        Route::get('/jobs/{jobStatus}/stream', JobStreamController::class);

        // DSK-7: consented local roots — also guarded by per-launch session token (DSK-3).
        Route::middleware('local.token')->group(function () {
            Route::get('/local-roots', [LocalRootController::class, 'index']);
            Route::post('/local-roots', [LocalRootController::class, 'store']);
            Route::delete('/local-roots/{localRoot}', [LocalRootController::class, 'destroy']);
        });

        Route::post('/projects/{project}/snapshot', [SnapshotController::class, 'store'])
            ->middleware('throttle:expensive');
        Route::post('/projects/{project}/analyze', [AnalyzeController::class, 'store'])
            ->middleware('throttle:expensive');
        Route::post('/projects/{project}/rescan', [AnalyzeController::class, 'rescan'])
            ->middleware('throttle:expensive');
    });
});
