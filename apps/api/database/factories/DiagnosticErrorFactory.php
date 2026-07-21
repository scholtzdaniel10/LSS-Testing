<?php

namespace Database\Factories;

use App\Models\DiagnosticError;
use App\Models\Scan;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<DiagnosticError>
 */
class DiagnosticErrorFactory extends Factory
{
    protected $model = DiagnosticError::class;

    public function definition(): array
    {
        $line = fake()->numberBetween(1, 200);

        return [
            'scan_id' => Scan::factory(),
            'source' => 'phpstan',
            'rule_id' => 'generic.error',
            'kind' => 'other',
            'severity' => 'error',
            'file' => 'app/Example.php',
            'range' => [
                'startLine' => $line,
                'startCol' => 1,
                'endLine' => $line,
                'endCol' => 80,
            ],
            'message' => fake()->sentence(),
            'explanation' => null,
            'upstream' => [],
            'downstream' => [],
        ];
    }
}
