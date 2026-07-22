<?php

use App\Models\User;
use Illuminate\Support\Facades\Artisan;
use Laravel\Sanctum\PersonalAccessToken;

/**
 * DSK-3 — desktop:token artisan command.
 *
 * Verifies:
 *   1. Running the command creates the desktop user when absent.
 *   2. Running it twice leaves exactly one `desktop`-labelled token.
 *   3. The output is a non-empty string that looks like a Sanctum token.
 */
describe('desktop:token command', function () {
    it('creates the desktop user when the user does not exist', function () {
        User::query()->where('email', 'desktop@lss.local')->delete();

        $this->artisan('desktop:token')->assertSuccessful();

        expect(User::query()->where('email', 'desktop@lss.local')->exists())->toBeTrue();
    });

    it('leaves exactly one desktop-labelled token after two runs', function () {
        User::query()->where('email', 'desktop@lss.local')->delete();

        $this->artisan('desktop:token')->assertSuccessful();
        $this->artisan('desktop:token')->assertSuccessful();

        $user = User::query()->where('email', 'desktop@lss.local')->firstOrFail();
        $count = PersonalAccessToken::query()
            ->where('tokenable_id', $user->id)
            ->where('name', 'desktop')
            ->count();

        expect($count)->toBe(1);
    });

    it('outputs a non-empty plain token string', function () {
        User::query()->where('email', 'desktop@lss.local')->delete();

        Artisan::call('desktop:token');
        $output = trim(Artisan::output());

        // Sanctum plain tokens are of the form <id>|<hash> — at minimum non-empty.
        expect($output)->not->toBeEmpty();
        expect($output)->toContain('|');
    });
});
