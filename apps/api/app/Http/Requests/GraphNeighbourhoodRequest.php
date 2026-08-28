<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * IG-33: query params for GET /projects/{project}/graph/neighbourhood.
 * `focus` is a folder hub (`dir:app` / `app`) or a file node. `radius` is
 * hop count (default 1), clamped 1–3. Non-numeric radius still 422.
 */
class GraphNeighbourhoodRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        $rawFocus = $this->input('focus');
        if (is_string($rawFocus)) {
            $this->merge(['focus' => trim($rawFocus)]);
        }

        $raw = $this->input('radius', 1);

        if ($raw === null || $raw === '') {
            $this->merge(['radius' => 1]);

            return;
        }

        if (is_numeric($raw)) {
            $this->merge(['radius' => max(1, min((int) $raw, 3))]);
        }
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'focus' => ['required', 'string', 'min:1', 'max:1024'],
            'radius' => ['required', 'integer', 'min:1', 'max:3'],
        ];
    }

    public function focus(): string
    {
        return (string) $this->validated()['focus'];
    }

    public function radius(): int
    {
        return (int) $this->validated()['radius'];
    }
}
