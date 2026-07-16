<?php

// Contract C7: envelope shape { data, meta, errors }; health is unauthenticated.
it('reports healthy through the v1 envelope', function () {
    $this->getJson('/api/v1/health')
        ->assertOk()
        ->assertJsonStructure([
            'data' => ['status', 'time'],
            'meta' => ['version'],
            'errors',
        ])
        ->assertJsonPath('data.status', 'ok')
        ->assertJsonPath('meta.version', 'v1')
        ->assertJsonPath('errors', []);
});
