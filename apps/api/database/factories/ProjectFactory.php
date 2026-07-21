<?php

namespace Database\Factories;

use App\Models\Project;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Project>
 */
class ProjectFactory extends Factory
{
    protected $model = Project::class;

    public function definition(): array
    {
        $name = fake()->slug(2);

        return [
            'name' => $name,
            'source_type' => 'import',
            'sandbox_path' => "sandboxes/{$name}",
            'local_source_path' => null,
            'last_imported_at' => null,
        ];
    }
}
