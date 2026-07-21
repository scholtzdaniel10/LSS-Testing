<?php

namespace Database\Factories;

use App\Models\Project;
use App\Models\Scan;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<Scan>
 */
class ScanFactory extends Factory
{
    protected $model = Scan::class;

    public function definition(): array
    {
        return [
            'project_id' => Project::factory(),
            'scan_hash' => Str::random(12),
            'status' => 'done',
            'analyser_status' => null,
        ];
    }
}
