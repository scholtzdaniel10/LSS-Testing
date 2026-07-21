<?php

namespace Database\Factories;

use App\Models\Project;
use App\Models\UsageReport;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<UsageReport>
 */
class UsageReportFactory extends Factory
{
    protected $model = UsageReport::class;

    public function definition(): array
    {
        return [
            'project_id' => Project::factory(),
            'report' => [
                'uses' => ['languages' => [], 'frameworks' => [], 'deps' => []],
                'needs' => ['missingDeps' => [], 'envVars' => [], 'services' => []],
            ],
        ];
    }
}
