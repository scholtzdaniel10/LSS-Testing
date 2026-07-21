<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        foreach (['Daniel' => 'daniel@lss.local', 'Jean' => 'jean@lss.local'] as $name => $email) {
            if (! User::query()->where('email', $email)->exists()) {
                User::factory()->create(['name' => $name, 'email' => $email]);
            }
        }

        // No demo projects — real linked programs li