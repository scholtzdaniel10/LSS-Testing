<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * PLT-6: validate query params for the health-report history endpoint.
 * Prevents Carbon::parse() from receiving arbitrary strings and throwing a 500.
 */
class HealthReportHistoryRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'from' => ['sometimes', 'nullable', 'date'],
            'to' => ['sometimes', 'nullable', 'date'],
            'per_page' => ['sometimes', 'integer', 'between:1,100'],
        ];
    }
}
