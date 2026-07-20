<?php

use App\Models\User;
use Illuminate\Testing\Fluent\AssertableJson;

// PLT-4: bearer auth everywhere except service health (contract C7).
describe('Authentication', function () {
    it('keeps service health public', function () {
        $this->getJson('/api/v1/health')->assertOk();
    });

    it('rejects unauthenticated requests with a 401 envelope', function () {
        $this->getJson('/api/v1/projects')
            ->assertUnauthorized()
            ->assertJson(fn (AssertableJson $json) => $json
                ->where('data', null)
                ->has('errors', 1)
                ->where('errors.0.title', 'Unauthenticated')
                ->where('errors.0.status', 401)
                ->etc()
            );
    });

    it('accepts a real issued token', function () {
        $this->seed();
        $user = User::query()->where('email', 'daniel@lss.local')->firstOrFail();
        $token = $user->createToken('test')->plainTextToken;

        $this->getJson('/api/v1/projects', ['Authorization' => "Bearer {$token}"])
            ->assertOk();
    });
});
