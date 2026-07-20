<?php

namespace App\Providers;

use App\Services\Diagnostics\AnalysisRunner;
use App\Support\Sandbox\IgnoreRules;
use App\Support\Sandbox\PathJail;
use App\Support\Sandbox\ProjectWorkspace;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        $this->app->singleton(PathJail::class, fn () => PathJail::fromConfig());
        $this->app->singleton(ProjectWorkspace::class, fn ($app) => new ProjectWorkspace($app->make(PathJail::class)));
        $this->app->singleton(IgnoreRules::class, fn () => IgnoreRules::fromConfig());
        $this->app->singleton(AnalysisRunner::class, fn () => AnalysisRunner::withDefaults());
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        // PLT-5 (contract C7): named rate buckets. `api` for reads, `expensive`
        // for import/analyze/snapshot/test-run triggers. Cache-store backed:
        // database cache locally, Redis in production — env only, no code change.
        RateLimiter::for('api', fn (Request $request): Limit => Limit::perMinute(120)
            ->by($request->user()?->id ?? $request->ip()));

        RateLimiter::for('expensive', fn (Request $request): Limit => Limit::perMinute(10)
            ->by($request->user()?->id ?? $request->ip()));
    }
}
