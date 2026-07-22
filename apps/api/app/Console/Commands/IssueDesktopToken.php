<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Str;

/**
 * DSK-3: issues a fresh Sanctum token for the headless desktop user.
 * Previous `desktop`-labelled tokens are deleted first so token rows
 * do not accumulate across launches.  Outputs ONLY the plain token via
 * $this->line() so a batch `for /f` can capture it cleanly.
 */
class IssueDesktopToken extends Command
{
    protected $signature = 'desktop:token';

    protected $description = 'Find-or-create the desktop@lss.local user, revoke previous desktop tokens, issue a fresh one (prints plain token only)';

    public function handle(): int
    {
        $user = User::query()->firstOrCreate(
            ['email' => 'desktop@lss.local'],
            [
                'name'     => 'Desktop',
                'password' => Str::random(40),
            ],
        );

        // Delete all existing tokens labelled `desktop` to prevent row buildup
        // and immediately invalidate tokens from prior launches.
        $user->tokens()->where('name', 'desktop')->delete();

        $token = $user->createToken('desktop');

        $this->line($token->plainTextToken);

        return self::SUCCESS;
    }
}
