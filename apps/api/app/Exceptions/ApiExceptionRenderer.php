<?php

namespace App\Exceptions;

use App\Support\Api\ApiResponse;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

class ApiExceptionRenderer
{
    public static function register(Exceptions $exceptions): void
    {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request): bool => $request->is('api/*'),
        );

        $exceptions->render(function (ValidationException $exception, Request $request) {
            if (! $request->is('api/*')) {
                return null;
            }

            $violations = collect($exception->errors())
                ->flatMap(
                    fn (array $messages, string $field): array => array_map(
                        fn (string $message): array => ['field' => $field, 'message' => $message],
                        $messages,
                    ),
                )
                ->values()
                ->all();

            return ApiResponse::failure([
                ApiResponse::problem(
                    title: 'Validation failed',
                    detail: 'One or more fields are invalid.',
                    status: 422,
                    instance: $request->getPathInfo(),
                    extensions: ['violations' => $violations],
                ),
            ], status: 422);
        });

        $exceptions->render(function (NotFoundHttpException $exception, Request $request) {
            if (! $request->is('api/*')) {
                return null;
            }

            return ApiResponse::failure([
                ApiResponse::problem(
                    title: 'Not found',
                    detail: 'The requested resource does not exist.',
                    status: 404,
                    instance: $request->getPathInfo(),
                ),
            ], status: 404);
        });

        $exceptions->render(function (ModelNotFoundException $exception, Request $request) {
            if (! $request->is('api/*')) {
                return null;
            }

            return ApiResponse::failure([
                ApiResponse::problem(
                    title: 'Not found',
                    detail: 'The requested resource does not exist.',
                    status: 404,
                    instance: $request->getPathInfo(),
                ),
            ], status: 404);
        });

        $exceptions->render(function (AuthenticationException $exception, Request $request) {
            if (! $request->is('api/*')) {
                return null;
            }

            return ApiResponse::failure([
                ApiResponse::problem(
                    title: 'Unauthenticated',
                    detail: 'A valid bearer token is required.',
                    status: 401,
                    instance: $request->getPathInfo(),
                ),
            ], status: 401);
        });

        $exceptions->render(function (\Throwable $exception, Request $request) {
            if (! $request->is('api/*')) {
                return null;
            }

            $status = $exception instanceof HttpExceptionInterface
                ? $exception->getStatusCode()
                : 500;

            if ($status >= 500 && ! config('app.debug')) {
                return ApiResponse::failure([
                    ApiResponse::problem(
                        title: 'Server error',
                        detail: 'An unexpected error occurred.',
                        status: 500,
                        instance: $request->getPathInfo(),
                    ),
                ], status: 500);
            }

            if ($status < 500) {
                $response = ApiResponse::failure([
                    ApiResponse::problem(
                        title: class_basename($exception),
                        detail: $exception->getMessage() !== '' ? $exception->getMessage() : 'Request could not be completed.',
                        status: $status,
                        instance: $request->getPathInfo(),
                    ),
                ], status: $status);

                // Preserve HTTP-exception headers — 429 must keep Retry-After (C7).
                if ($exception instanceof HttpExceptionInterface) {
                    $response->withHeaders($exception->getHeaders());
                }

                return $response;
            }

            return null;
        });
    }
}
