<?php

namespace Database\Factories;

use App\Models\GraphSnapshot;
use App\Models\Project;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<GraphSnapshot>
 */
class GraphSnapshotFactory extends Factory
{
    protected $model = GraphSnapshot::class;

    public function definition(): array
    {
        return [
            'project_id' => Project::factory(),
            'scanned_at' => now(),
            'edges' => [],
        ];
    }
}
