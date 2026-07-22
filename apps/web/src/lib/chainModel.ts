import type { DiagnosticFinding, ErrorChain } from '../api/client';

/**
 * DX-11: view model for the chain list — grouped by chain, root cause first,
 * expandable to the other affected errors. Grouping mirrors DX-8's server-side
 * detection exactly (it is driven by the meta.chains payload, never recomputed
 * client-side).
 */
export type ChainGroup = {
  chainId: string;
  /** Root-cause finding (most-upstream). Null only if the id is not in the list. */
  root: DiagnosticFinding | null;
  /** All members, root first, then the rest in list order. */
  members: DiagnosticFinding[];
};

export function groupByChain(
  errors: DiagnosticFinding[],
  chains: ErrorChain[],
): { chainGroups: ChainGroup[]; unchained: DiagnosticFinding[] } {
  const byId = new Map(errors.map((e) => [e.id, e]));
  const chained = new Set<string>();

  const chainGroups: ChainGroup[] = [];
  for (const chain of chains) {
    const members = chain.errorIds
      .map((id) => byId.get(id))
      .filter((e): e is DiagnosticFinding => e !== undefined);
    if (members.length === 0) continue;

    members.forEach((m) => chained.add(m.id));

    const rootId = chain.rootErrorIds[0];
    const root = (rootId && byId.get(rootId)) || null;
    const ordered = root
      ? [root, ...members.filter((m) => m.id !== root.id)]
      : members;

    chainGroups.push({ chainId: chain.chainId, root, members: ordered });
  }

  return {
    chainGroups,
    unchained: errors.filter((e) => !chained.has(e.id)),
  };
}

/**
 * DX-13 chain walking: resolve a file reference (from an upstream/downstream
 * list) to a finding so the pane can navigate to it. Prefers a member of the
 * given chain, then any finding on that file.
 */
export function findingForFile(
  file: string,
  errors: DiagnosticFinding[],
  chainMembers: DiagnosticFinding[] = [],
): DiagnosticFinding | null {
  return (
    chainMembers.find((e) => e.file === file)
    ?? errors.find((e) => e.file === file)
    ?? null
  );
}
