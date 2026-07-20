<?php

namespace App\Providers;

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
        //
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
