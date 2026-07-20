<?php

use App\Models\User;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

pest()->extend(TestCase::class)->in('Feature');

/** Authenticate the current test as a seeded-style user (PLT-4 bearer auth). */
function asUser(): User
{
    $user = User::factory()->create();
    Sanctum::actingAs($user);

    return $user;
}
