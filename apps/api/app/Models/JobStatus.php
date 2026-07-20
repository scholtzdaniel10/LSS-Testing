<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * PLT-7 queued-job status pattern: import, analysis and snapshot jobs report
 * queued -> running -> done|failed here; the UI polls GET /api/v1/jobs/{id}.
 */
class JobStatus extends Model
{
    use HasUuids;

    public const STATUS_QUEUED = 'queued';

    public const STATUS_RUNNING = 'running';

    public const STATUS_DONE = 'done';

    public const STATUS_FAILED = 'failed';

    public $incrementing = false;

    protected $keyType = 'string';

    protected $fillable = [
        'type',
        'project_id',
        'status',
        'progress',
        'message',
    ];

    protected function casts(): array
    {
        return [
            'progress' => 'integer',
        ];
    }

    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    public function markRunning(int $progress = 0): void
    {
        $this->update(['status' => self::STATUS_RUNNING, 'progress' => $progress]);
    }

    public function markDone(?string $message = null): void
    {
        $this->update(['status' => self::STATUS_DONE, 'progress' => 100, 'message' => $message]);
    }

    public function markFailed(string $message): void
    {
        $this->update(['status' => self::STATUS_FAILED, 'message' => $message]);
    }
}
