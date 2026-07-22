<?php

namespace App\Services\Diagnostics;

/**
 * DX-22: registry of all active analyser adapter ids.
 *
 * The C5 schema previously used a closed enum for `source`; that is now an
 * open string validated HERE at runtime. EvidenceGate injects this registry
 * so that accepting a finding from an unregistered source is rejected, and
 * registering a new adapter automatically widens the valid set with no schema
 * edit needed.
 */
final class AnalyzerRegistry
{
    /** @var array<string, Analyzer> keyed by source() id */
    private array $adapters = [];

    /**
     * @param  list<Analyzer>  $adapters
     */
    public function __construct(array $adapters = [])
    {
        foreach ($adapters as $adapter) {
            $this->register($adapter);
        }
    }

    public function register(Analyzer $adapter): void
    {
        $this->adapters[$adapter->source()] = $adapter;
    }

    /** Returns true when $source matches a registered adapter id. */
    public function isRegistered(string $source): bool
    {
        return isset($this->adapters[$source]);
    }

    /** @return list<string> */
    public function registeredIds(): array
    {
        return array_keys($this->adapters);
    }

    /** @return list<Analyzer> */
    public function all(): array
    {
        return array_values($this->adapters);
    }
}
