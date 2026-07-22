<?php

namespace App\Services\Diagnostics;

use Illuminate\Support\Str;

/**
 * DX-8: error-chain detection.
 *
 * Errors whose files sit on a shared dependency path are linked into one
 * chain; the root cause is the most-upstream error — the one whose file no
 * other chain member's file depends-into. Two errors are connected when they
 * share a file, or one error's file is (transitively, within the resolver's
 * depth cap) downstream of the other's.
 *
 * Chains are only assigned to groups of two or more errors — a lone error is
 * not a chain.
 */
final class ChainDetector
{
    /**
     * @param  list<array{id: string, file: string}>  $errors
     * @return array<string, array{chainId: string|null, isRoot: bool}> keyed by error id
     */
    public function detect(array $errors, ImpactResolver $resolver): array
    {
        $count = count($errors);

        /** @var array<string, array<string, true>> file => set of files downstream of it */
        $downstreamByFile = [];
        foreach ($errors as $error) {
            $file = $error['file'];
            if (! isset($downstreamByFile[$file])) {
                $downstreamByFile[$file] = array_fill_keys($resolver->downstream($file), true);
            }
        }

        // Union-find over error indices.
        $parent = range(0, max(0, $count - 1));
        $find = function (int $i) use (&$parent, &$find): int {
            return $parent[$i] === $i ? $i : ($parent[$i] = $find($parent[$i]));
        };
        $union = function (int $a, int $b) use (&$parent, $find): void {
            $parent[$find($a)] = $find($b);
        };

        for ($i = 0; $i < $count; $i++) {
            for ($j = $i + 1; $j < $count; $j++) {
                $fileI = $errors[$i]['file'];
                $fileJ = $errors[$j]['file'];
                if ($fileI === $fileJ
                    || isset($downstreamByFile[$fileI][$fileJ])
                    || isset($downstreamByFile[$fileJ][$fileI])) {
                    $union($i, $j);
                }
            }
        }

        /** @var array<int, list<int>> component root index => member error indices */
        $components = [];
        for ($i = 0; $i < $count; $i++) {
            $components[$find($i)][] = $i;
        }

        $result = [];
        foreach ($components as $members) {
            if (count($members) < 2) {
                $result[$errors[$members[0]]['id']] = ['chainId' => null, 'isRoot' => false];

                continue;
            }

            $chainId = (string) Str::uuid();
            $memberFiles = array_unique(array_map(
                static fn (int $i): string => $errors[$i]['file'],
                $members,
            ));

            // Root file(s): not downstream of any other member file.
            $rootFiles = [];
            foreach ($memberFiles as $file) {
                $isDownstreamOfMember = false;
                foreach ($memberFiles as $other) {
                    if ($other !== $file && isset($downstreamByFile[$other][$file])) {
                        $isDownstreamOfMember = true;

                        break;
                    }
                }
                if (! $isDownstreamOfMember) {
                    $rootFiles[$file] = true;
                }
            }

            foreach ($members as $i) {
                $result[$errors[$i]['id']] = [
                    'chainId' => $chainId,
                    'isRoot' => isset($rootFiles[$errors[$i]['file']]),
                ];
            }
        }

        return $result;
    }
}
