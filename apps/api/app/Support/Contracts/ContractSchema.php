<?php

namespace App\Support\Contracts;

use InvalidArgumentException;
use Opis\JsonSchema\Errors\ErrorFormatter;
use Opis\JsonSchema\Validator;
use RuntimeException;

/**
 * PLT-9: load frozen contract schemas from packages/schemas (never a local copy)
 * and validate C1–C6 documents. C7 is behavioural (envelope), not a payload shape.
 */
final class ContractSchema
{
    public const C1 = 'target-environment';

    public const C2 = 'health-snapshot';

    public const C3 = 'dependency-edge';

    public const C4 = 'usage-report';

    public const C5 = 'diagnostic-error';

    public const C6 = 'test';

    /** @var array<string, string> */
    private const FILES = [
        self::C1 => 'target-environment.schema.json',
        self::C2 => 'health-snapshot.schema.json',
        self::C3 => 'dependency-edge.schema.json',
        self::C4 => 'usage-report.schema.json',
        self::C5 => 'diagnostic-error.schema.json',
        self::C6 => 'test.schema.json',
    ];

    private static ?Validator $validator = null;

    /** @var array<string, object> */
    private static array $schemas = [];

    public static function directory(): string
    {
        $candidates = [
            dirname(base_path(), 2).DIRECTORY_SEPARATOR.'packages'.DIRECTORY_SEPARATOR.'schemas',
            base_path('schemas'),
            resource_path('schemas'),
        ];
        foreach ($candidates as $dir) {
            if (is_dir($dir) && is_file($dir.DIRECTORY_SEPARATOR.'health-snapshot.schema.json')) {
                return $dir;
            }
        }

        throw new RuntimeException(
            'Contract schemas not found. Expected packages/schemas next to the monorepo root (PLT-9).',
        );
    }

    public static function path(string $contract): string
    {
        $file = self::FILES[$contract] ?? null;
        if ($file === null) {
            throw new InvalidArgumentException("Unknown contract '{$contract}'.");
        }

        return self::directory().DIRECTORY_SEPARATOR.$file;
    }

    /**
     * @param  array<string, mixed>|list<mixed>|object  $document
     */
    public static function validate(string $contract, mixed $document): void
    {
        $result = self::validator()->validate(
            self::toJson($document),
            self::schema($contract),
        );

        if ($result->isValid()) {
            return;
        }

        $error = $result->error();
        $formatted = $error !== null
            ? (new ErrorFormatter)->format($error)
            : ['(no error detail)'];

        throw new InvalidArgumentException(
            'Contract '.$contract.' (C'.self::contractNumber($contract).') document is invalid: '
            .json_encode($formatted, JSON_UNESCAPED_SLASHES),
        );
    }

    public static function isValid(string $contract, mixed $document): bool
    {
        try {
            self::validate($contract, $document);

            return true;
        } catch (InvalidArgumentException) {
            return false;
        }
    }

    private static function schema(string $contract): object
    {
        if (! isset(self::$schemas[$contract])) {
            $raw = file_get_contents(self::path($contract));
            if ($raw === false) {
                throw new RuntimeException('Could not read schema '.$contract);
            }
            $decoded = json_decode($raw);
            if (! is_object($decoded)) {
                throw new RuntimeException('Schema '.$contract.' is not a JSON object');
            }
            self::$schemas[$contract] = $decoded;
        }

        return self::$schemas[$contract];
    }

    private static function validator(): Validator
    {
        return self::$validator ??= new Validator;
    }

    private static function toJson(mixed $document): mixed
    {
        return json_decode(json_encode($document, JSON_THROW_ON_ERROR));
    }

    private static function contractNumber(string $contract): string
    {
        return match ($contract) {
            self::C1 => '1',
            self::C2 => '2',
            self::C3 => '3',
            self::C4 => '4',
            self::C5 => '5',
            self::C6 => '6',
            default => '?',
        };
    }
}
