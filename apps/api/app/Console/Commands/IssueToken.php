<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;

/**
 * PLT-4: bearer tokens for the two humans (and their agents). Printed once,
 * never stored in plaintext — Sanctum keeps only the hash.
 */
class IssueToken extends Command
{
    protected $signature = 'token:issue {email : User email} {--label=cli : Token label, e.g. cli, web, cursor}';

    protected $description = 'Issue a Sanctum bearer token for a user (prints it once)';

    public function handle(): int
    {
        $email = (string) $this->argument('email');
        $user = User::query()->where('email', $email)->first();

        if ($user === null) {
            $this->error("No user with email {$email}. Seed users first: php artisan db:seed");

            return self::FAILURE;
        }

        $token = $user->createToken((string) $this->option('label'));

        $this->info("Token for {$email} ({$this->option('label')}) — copy it now, it is not shown again:");
        $this->line($token->plainTextToken);

        return self::SUCCESS;
    }
}
