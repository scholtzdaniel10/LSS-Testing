<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Scan extends Model
{
    use HasUuids;

    public $incrementing = false;

    protected $keyType = 'string';

    protected $fillable = [
        'project_id',
        'scan_hash',
        'status',
        'analyser_status',
    ];

    protected function casts(): array
    {
        return [
            'analyser_status' => 'array',
        ];
    }

    public function project(): BelongsTo
    {
        return 