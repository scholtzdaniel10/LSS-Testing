<?php

use App\Models\Project;

// PLT-5: named buckets, 429 + Retry-After (contract C7).
describe('Rate limiting', function () {
    it('throttles the expensive bucket at 10/min with Retry-After', function () {
        $this->seed();
        asUser();
        $project = Project::query()->firstOrFail();

        foreach (range(1, 10) as $i) {
            $this->postJson("/api/v1/projects/{$project->id}/snapshot")->assertStatus(202);
        }

        $this->postJson("/api/v1/projects/{$project->id}/snapshot")
            ->assertStatus(429)
            ->assertHeader('Retry-After');
    });
});
