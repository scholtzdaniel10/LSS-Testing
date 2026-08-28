<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Query params for GET /projects/{project}/graph/overview.
 * `limit` is a fileCap (default 40); out-of-range values are clamped to
 * 1…config('graph.aggregate_max_nodes'). Non-numeric values still 422.
 */
class GraphOverviewRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        $max = $this->maxNodes();
        $raw = $this->input('limit', 40);

        if ($raw === null || $raw === '') {
            $this->merge(['limit' => 40]);

            return;
        }

        if (is_numeric($raw)) {
            $this->merge(['limit' => max(1, min((int) $raw, $max))]);
        }
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        $max = $this->maxNodes();

        return [
            'limit' => ['required', 'integer', 'min:1', 'max:'.$max],
        ];
    }

    public function fileCap(): int
    {
        return (int) $this->validated()['limit'];
    }

    private function maxNodes(): int
    {
        return max(1, (int) config('graph.aggregate_max_nodes', 200));
    }
}
