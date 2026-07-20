<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreTargetEnvironmentRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:80'],
            'baseUrl' => ['required', 'url', 'max:500'],
            'notes' => ['sometimes', 'nullable', 'string', 'max:2000'],
        ];
    }
}
