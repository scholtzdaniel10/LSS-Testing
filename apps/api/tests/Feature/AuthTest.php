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
        $user = User::factory()->create();
        $token = $user->createToken('test')->plainTextToken;

        $this->getJson('/api/v1/projects', ['Authorization' => "Bearer {$token}"])
            ->assertOk();
    });

    // DX-auth: email/password login issues a Sanctum PAT under the C7 envelope.
    describe('login', function () {
        it('issues a token for valid credentials', function () {
            $user = User::factory()->create(['email' => 'daniel@lss.local']);

            $response = $this->postJson('/api/v1/auth/login', [
                'email' => 'daniel@lss.local',
                'password' => 'password',
            ])
                ->assertOk()
                ->assertJson(fn (AssertableJson $json) => $json
                    ->whereType('data.token', 'string')
                    ->where('data.user.id', $user->id)
                    ->where('data.user.name', $user->name)
                    ->where('data.user.email', 'daniel@lss.local')
                    ->missing('data.user.password')
                    ->where('errors', [])
                    ->etc()
                );

            $token = $response->json('data.token');

            $this->getJson('/api/v1/projects', ['Authorization' => "Bearer {$token}"])
                ->assertOk();

            expect($user->tokens()->where('name', 'web')->count())->toBe(1);
        });

        it('rejects a wrong password with a 401 envelope and issues no token', function () {
            $user = User::factory()->create(['email' => 'daniel@lss.local']);

            $this->postJson('/api/v1/auth/login', [
                'email' => 'daniel@lss.local',
                'password' => 'not-the-password',
            ])
                ->assertUnauthorized()
                ->assertJson(fn (AssertableJson $json) => $json
                    ->where('data', null)
                    ->has('errors', 1)
                    ->where('errors.0.title', 'Invalid credentials')
                    ->where('errors.0.status', 401)
                    ->etc()
                );

            expect($user->tokens()->count())->toBe(0);
        });

        it('rejects an unknown email with the same 401 envelope', function () {
            $this->postJson('/api/v1/auth/login', [
                'email' => 'nobody@lss.local',
                'password' => 'password',
            ])
                ->assertUnauthorized()
                ->assertJsonPath('errors.0.title', 'Invalid credentials');
        });

        it('validates the request body with a 422 envelope', function () {
            $this->postJson('/api/v1/auth/login', ['email' => 'not-an-email'])
                ->assertUnprocessable()
                ->assertJsonPath('errors.0.title', 'Validation failed')
                ->assertJsonPath('errors.0.violations.*.field', fn (array $fields): bool => in_array('email', $fields, true)
                    && in_array('password', $fields, true));
        });

        it('throttles repeated failed attempts with 429 + Retry-After', function () {
            User::factory()->create(['email' => 'daniel@lss.local']);

            foreach (range(1, 5) as $i) {
                $this->postJson('/api/v1/auth/login', [
                    'email' => 'daniel@lss.local',
                    'password' => 'wrong',
                ])->assertUnauthorized();
            }

            $this->postJson('/api/v1/auth/login', [
                'email' => 'daniel@lss.local',
                'password' => 'password',
            ])
                ->assertStatus(429)
                ->assertHeader('Retry-After');
        });
    });

    describe('logout', function () {
        it('revokes only the current token', function () {
            $user = User::factory()->create();
            $current = $user->createToken('web')->plainTextToken;
            $other = $user->createToken('desktop')->plainTextToken;

            $this->postJson('/api/v1/auth/logout', [], ['Authorization' => "Bearer {$current}"])
                ->assertNoContent();

            expect($user->tokens()->count())->toBe(1);

            $this->app['auth']->forgetGuards();
            $this->getJson('/api/v1/projects', ['Authorization' => "Bearer {$current}"])
                ->assertUnauthorized();

            $this->app['auth']->forgetGuards();
            $this->getJson('/api/v1/projects', ['Authorization' => "Bearer {$other}"])
                ->assertOk();
        });

        it('requires authentication', function () {
            $this->postJson('/api/v1/auth/logout')
                ->assertUnauthorized();
        });
    });
});
