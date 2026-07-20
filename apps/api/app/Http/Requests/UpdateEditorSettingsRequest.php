<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class UpdateEditorSettingsRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'editor' => ['required', 'in:vscode,phpstorm,sublime,custom'],
            'customTemplate' => ['nullable', 'string', 'max:500'],
            'localRoot' => ['nullable', 'string', 'max:1024'],
        ];
    }
}
