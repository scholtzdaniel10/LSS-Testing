<?php

namespace App\Http\Controllers\Api\V1;

use App\Models\JobStatus;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Phase 4d: SSE progress for a job (polls JobStatus; works without Redis).
 */
class JobStreamController extends Controller
{
    public function __invoke(JobStatus $jobStatus): StreamedResponse
    {
        return response()->stream(function () use ($jobStatus): void {
            $deadline = time() + 660;
            $last = '';

            while (time() < $deadline) {
                $jobStatus->refresh();
                $payload = json_encode([
                    'id' => $jobStatus->id,
                    'status' => $jobStatus->status,
                    'progress' => $jobStatus->progress,
                    'message' => $jobStatus->message,
                    'result' => $jobStatus->result,
                ], JSON_THROW_ON_ERROR);

                if ($payload !== $last) {
                    echo "event: job\ndata: {$payload}\n\n";
                    $last = $payload;
                    if (function_exists('ob_flush')) {
                        @ob_flush();
                    }
                    @flush();
                }

                if (in_array($jobStatus->status, [JobStatus::STATUS_DONE, JobStatus::STATUS_FAILED], true)) {
                    echo "event: end\ndata: {$payload}\n\n";
                    @flush();

                    return;
                }

                usleep(400_000);
            }

            echo "event: timeout\ndata: {\"message\":\"stream timeout\"}\n\n";
            @flush();
        }, 200, [
            'Content-Type' => 'text/event-stream',
            'Cache-Control' => 'no-cache',
            'X-Accel-Buffering' => 'no',
        ]);
    }
}
