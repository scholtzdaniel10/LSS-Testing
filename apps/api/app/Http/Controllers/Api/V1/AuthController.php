<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Requests\LoginRequest;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\PersonalAccessToken;

/**
 * DX-auth — email/password login for the web SPA (PLT-4 bearer auth, contract C7).
 *
 * POST /auth/login   { email, password } → { token, user: { id, name, email } }
 * POST /auth/logout  revoke the bearer token used for this request (204)
 *
 * Login is the only credential-bearing public endpoint, so it sits in its own
 * `login` rate bucket (per IP + email) rather than the generic `api` one.
 * Unknown-email and wrong-password both yield the same 401 problem so the
 * endpoint cannot be used to enumerate accounts.
 */
class AuthController extends Controller
{
    private const TOKEN_NAME = 'web';

    public function login(LoginRequest $request): JsonResponse
    {
        $email = (string) $request->validated('email');
        $password = (string) $request->validated('password');

        $user = User::query()->where('email', $email)->first();

        if (! $user instanceof User || ! Hash::check($password, $user->password)) {
            return ApiResponse::failure([
                ApiResponse::problem(
                    title: 'Invalid credentials',
                    detail: 'The email or password is incorrect.',
                    status: 401,
                    instance: $request->getPathInfo(),
                ),
            ], status: 401);
        }

        $token = $user->createToken(self::TOKEN_NAME)->plainTextToken;

        return $this->respond([
            'token' => $token,
            'user' => [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
            ],
        ]);
    }

    public function logout(Request $request): Response
    {
        $token = $request->user()?->currentAccessToken();

        // Only persisted PATs can be revoked; a transient token (e.g. Sanctum::actingAs)
        // has nothing to delete, so logout is a no-op for it.
        if ($token instanceof PersonalAccessToken) {
            $token->delete();
        }

        return response()->noContent();
    }
}
