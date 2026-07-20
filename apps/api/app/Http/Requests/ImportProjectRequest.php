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
            'archive' => ['required', 'file', 'max:131072'],
            'name' => ['sometimes', 'string', 'max:120'],
            'resumeToken' => ['sometimes', 'string', 'max:64'],
        ];
    }

    /** @return array<string, string> */
    public function messages(): array
    {
        return [
            'archive.required' => 'No archive was received. If the zip is large, restart the API with: php -d upload_max_filesize=512M -d post_max_size=512M artisan serve',
            'archive.file' => 'The upload did not arrive as a file. Check PHP upload_max_filesize and post_max_size.',
            'archive.max' => 'Archive exceeds the 128 MB server limit.',
        ];
    }

    public function withValidator($validator): void
    {
        $validator->after(function ($validator): void {
            if (! $this->hasFile('archive')) {
                $contentLength = (int) ($this->server('CONTENT_LENGTH') ?? 0);
                if ($contentLength > 0) {
                    $validator->errors()->add(
                        'archive',
                        'Request body was truncated — likely exceeds PHP post_max_size. Restart the API with: php -d upload_max_filesize=512M -d post_max_size=512M artisan serve',
                    );
                }

                return;
            }

            $file = $this->file('archive');
            if ($file->isValid()) {
                return;
            }

            $message = match ($file->getError()) {
                UPLOAD_ERR_INI_SIZE => 'Archive exceeds PHP upload_max_filesize. Restart the API with: php -d upload_max_filesize=512M -d post_max_size=512M artisan serve',
                UPLOAD_ERR_FORM_SIZE => 'Archive exceeds PHP post_max_size.',
                UPLOAD_ERR_PARTIAL => 'Archive upload was interrupted — try again.',
                UPLOAD_ERR_NO_FILE => 'No archive was received.',
                default => 'Archive upload failed (PHP error code '.$file->getError().').',
            };
            $validator->errors()->add('archive', $message);
        });
    }
}
