<?php

/**
 * DSK-3 — RequireLocalLinkToken middleware feature tests.
 *
 * Covers: missing header, wrong header, correct header, and the
 * bypass path when config token is null (manual dev serve).
 */

use App\Models\LocalRoot;
use Illuminate\Support\Facades\File;

// ── Token enforced (config token set) ────────────────────────────────────────

it('returns 403 with local_link_token_invalid when header is missing', function () {
    asUser();
    config(['sandbox.local_link_token' => 'test-token-abc']);

    $this->getJson('/api/v1/local-roots')
        ->assertStatus(403)
        ->assertJsonPath('errors.0.code', 'local_link_token_invalid');
});

it('returns 403 with local_link_token_invalid when header value is wrong', function () {
    asUser();
    config(['sandbox.local_link_token' => 'test-token-abc']);

    $this->withHeader('X-LSS-Local-Token', 'wrong-value')
        ->getJson('/api/v1/local-roots')
        ->assertStatus(403)
        ->assertJsonPath('errors.0.code', 'local_link_token_invalid');
});

it('passes middleware when header matches the configured token', function () {
    asUser();
    config(['sandbox.local_link_token' => 'test-token-abc']);

    $this->withHeader('X-LSS-Local-Token', 'test-token-abc')
        ->getJson('/api/v1/local-roots')
        ->assertStatus(200);
});

it('guards POST /local-roots with the token', function () {
    asUser();
    config(['sandbox.local_link_token' => 'test-token-abc']);

    $dir = storage_path('framework/testing/token-post-'.uniqid());
    File::ensureDirectoryExists($dir);

    $this->postJson('/api/v1/local-roots', ['path' => $dir])
        ->assertStatus(403)
        ->assertJsonPath('errors.0.code', 'local_link_token_invalid');

    File::deleteDirectory($dir);
});

it('guards DELETE /local-roots/{id} with the token', function () {
    asUser();
    config(['sandbox.local_link_token' => 'test-token-abc']);

    $dir = storage_path('framework/testing/token-del-'.uniqid());
    File::ensureDirectoryExists($dir);

    // Create root record directly (bypass middleware for setup).
    $root = LocalRoot::query()->create(['path' => rtrim($dir, '/\\')]);

    $this->deleteJson("/api/v1/local-roots/{$root->id}")
        ->assertStatus(403)
        ->assertJsonPath('errors.0.code', 'local_link_token_invalid');

    File::deleteDirectory($dir);
});

// ── Token not set (dev bypass) ────────────────────────────────────────────────

it('allows requests without a header when config token is null', function () {
    asUser();
    config(['sandbox.local_link_token' => null]);

    $this->getJson('/api/v1/local-roots')
        ->assertStatus(200);
});

it('allows requests without a header when config token is empty string', function () {
    asUser();
    config(['sandbox.local_link_token' => '']);

    $this->getJson('/api/v1/local-roots')
        ->assertStatus(200);
});
