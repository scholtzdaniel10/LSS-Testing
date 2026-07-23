<?php

namespace App\Services;

class UserService
{
    public function greet(string $name): string
    {
        return 'Hello '.$name;
    }
}
