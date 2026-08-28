<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * IG-29: query params for GET /projects/{project}/graph/rollup.
 * `depth` is path-segment collapse (default 1 = first segment), clamped 1–4.
 */
class GraphRollupRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        $raw = $this->input('depth', 1);

        if ($raw === null || $raw === '') {
            $this->merge(['depth' => 1]);

            return;
        }

        if (is_numeric($raw)) {
            $this->merge(['depth' => max(1, min((int) $raw, 4))]);
        }
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'depth' => ['required', 'integer', 'min:1', 'max:4'],
        ];
    }

    public function depth(): int
    {
        return (int) $this->validated()['depth'];
    }
}
