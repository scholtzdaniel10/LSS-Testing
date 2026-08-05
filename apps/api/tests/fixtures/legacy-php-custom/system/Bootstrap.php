<?php

class Bootstrap
{
    public static function run(): void
    {
        $router = new Router;
        $router->dispatch();
    }
}
