<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class GraphSnapshot extends Model
{
    /** @use HasFactory<\Database\Factories\GraphSnapshotFactory> */
    use HasFactory, HasUuids;

    public $incrementing = false;

    protected $keyType = 'string';

    protected $fillable = [
        'project_id',
        'scanned_at',
        'edges',
    ];

    protected function casts(): array
    {
        return [
            'scanned_at' => 'datetime',
            'edges