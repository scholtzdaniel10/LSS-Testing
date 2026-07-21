<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class DiagnosticError extends Model
{
    /** @use HasFactory<\Database\Factories\DiagnosticErrorFactory> */
    use HasFactory, HasUuids;

    public $incrementing = false;

    protected $keyType = 'string';

    protected $table = 'errors';

    protected $fillable = [
        'scan_id',
        'source',
        'rule_id',
        'kind',
        'severity',
        'file',
        'range',
        'message',
        'explanation',
        'upstream',
        'downstream',
    ];

    protected function casts(): array
    {
        return [
            'range' => 'array',
            'upstream' => 'array',
            'downstream' => 'array',
        ];
    }

    public function scan(): BelongsTo
    {
        return $this->belongsTo(Scan::class);
    }
}
