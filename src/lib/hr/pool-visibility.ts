/**
 * Service Charge and tip pools under the pay-visibility rule (pay-visibility.ts) — the pure half,
 * with no imports so scripts/hr-misc-assert.cjs can load it.
 *
 * A pool is one store's month, and every action on it — saving allocations, recomputing, adding a
 * deduction, finalizing, announcing — reaches every allocation in it, just as every payrun action
 * reaches every slip. So pools follow the payrun rule (owner call 2026-09-13): a caller reads only the
 * people whose pay they may see, the totals are summed from those people alone, and one hidden person
 * disables every action (pool-access.ts). The pool total is withheld as well: the allocations add up
 * to it, so beside a partial list it hands back the hidden sum by subtraction.
 */

export interface PoolAllocationLike {
  user_id: string;
  allocated_satang: number;
  net_satang: number;
}

export interface PoolTotals {
  allocated: number;
  deducted: number;
  net: number;
}

export interface PoolView<T> {
  allocations: T[];
  totals: PoolTotals;
  /** Allocations withheld from this caller. > 0 means every figure on the page is partial. */
  hiddenCount: number;
}

export function partitionPoolAllocations<T extends PoolAllocationLike>(
  allocations: readonly T[],
  hiddenProfileIds: ReadonlySet<string>
): PoolView<T> {
  const visible = allocations.filter((a) => !hiddenProfileIds.has(a.user_id));
  const allocated = visible.reduce((sum, a) => sum + a.allocated_satang, 0);
  const net = visible.reduce((sum, a) => sum + a.net_satang, 0);
  return {
    allocations: visible,
    totals: { allocated, deducted: allocated - net, net },
    hiddenCount: allocations.length - visible.length,
  };
}
