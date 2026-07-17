<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class Project extends Model
{
    use HasUuids;

    public $incrementing = false;

    protected $keyType = 'string';

    protected $fillable = [
        'name',
        'sandbox_path',
        'last_imported_at',
    ];

    protected function casts(): array
    {
        return [
            'last_imported_at' => 'datetime',
        ];
    }

    public function files(): HasMany
    {
        return $this->hasMany(ProjectFile::class);
    }

    public function graphSnapshots(): HasMany
    {
        return $this->hasMany(GraphSnapshot::class);
    }

    public function usageReport(): HasOne
    {
        return $this->hasOne(UsageReport::class);
    }

    public function scans(): HasMany
    {
        return $this->hasMany(Scan::class);
    }

    public function healthSnapshots(): HasMany
    {
        return $this->hasMany(HealthSnapshot::class);
    }

    public function targetEnvironments(): HasMany
    {
        return $this->hasMany(TargetEnvironment::class);
    }
}
