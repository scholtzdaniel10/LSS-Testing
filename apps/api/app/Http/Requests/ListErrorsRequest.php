<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * PLT-6: controllers never touch raw input — filters for the Diagnose list
 * are validated here; invalid values 422 with field paths via the renderer.
 */
class ListErrorsRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'severity' => ['sometimes', 'in:error,warning,info'],
            'kind' => ['sometimes', 'string', 'max:64'],
            'file' => ['sometimes', 'string', 'max:1024'],
            'per_page' => ['sometimes', 'integer', 'between:1,100'],
            'cursor' => ['sometimes', 'string'],
            // DX-9: impact depth — default 1 (direct dependents), transitive
            // behind the parameter, matching IG-13's slider convention (1–3).
            'depth' => ['sometimes', 'integer', 'between:1,3'],
        ];
    }
}
