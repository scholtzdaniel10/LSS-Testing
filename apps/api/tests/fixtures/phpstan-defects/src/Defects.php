<?php

declare(strict_types=1);

namespace App\Broken;

final class Defects
{
    public function nullRisk(?object $user): string
    {
        return $user->name;
    }

    public function typeError(int $n): string
    {
        return $n;
    }

    public function undefinedVar(): int
    {
        return $missing;
    }

    public function badArg(): void
    {
        $this->needsInt('nope');
    }

    private function needsInt(int $n): void {}

    public function missingClass(): \App\Does\NotExist
    {
        return new \App\Does\NotExist;
    }
}
