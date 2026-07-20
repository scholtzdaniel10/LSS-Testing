<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class ImportProjectRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'archive' => ['required', 'file', 'max:512000'],
            'name' => ['sometimes', 'string', 'max:120'],
            'resumeToken' => ['sometimes', 'string', 'max:64'],
        ];
    }
}
