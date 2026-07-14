import type { SupabaseClient } from '@supabase/supabase-js';
import { reconcileScDeductions } from '@/lib/hr/service-charge';

const ALLOC = 'hr_sc_allocations';
const DED = 'hr_sc_deductions';

/**
 * Reconcile every allocation's SC deductions in a pool against ONE shared balance (§H aggregate
 * deferral). Each source is normally clamped against the full allocation independently, so several
 * sources hitting one person could together exceed the pool and silently drop the excess. This reads
 * all of a person's lines, re-splits applied vs carried across the whole set (see reconcileScDeductions),
 * and UPDATES only the lines whose split actually changed.
 *
 * Idempotent for carry-eligible lines (their amount+carry always re-equals the intended total). Call
 * after every deduction source has been laid down (recompute / eval apply-sc / apply-stock-penalties)
 * and again at finalize, so the locked pool is always aggregate-correct regardless of the order HR ran things.
 */
export async function reconcilePoolDeductions(service: SupabaseClient, poolId: string): Promise<void> {
  const { data: allocs, error: allocErr } = await service
    .from(ALLOC)
    .select('id, allocated_satang')
    .eq('pool_id', poolId);
  if (allocErr) throw allocErr;

  for (const a of allocs ?? []) {
    const allocId = a.id as string;
    const allocated = Number(a.allocated_satang) || 0;

    const { data: deds, error: dedErr } = await service
      .from(DED)
      .select('id, source_type, amount_satang, carry_satang')
      .eq('allocation_id', allocId)
      .order('created_at', { ascending: true });
    if (dedErr) throw dedErr;
    const rows = deds ?? [];
    if (rows.length === 0) continue;

    const reconciled = reconcileScDeductions(
      allocated,
      rows.map((d) => ({
        source_type: d.source_type as string,
        // the full intended deduction = what's applied now + what's already carried
        intended_satang: (Number(d.amount_satang) || 0) + (Number(d.carry_satang) || 0),
      }))
    );

    for (let i = 0; i < rows.length; i++) {
      const d = rows[i];
      const r = reconciled[i];
      if (r.amount_satang !== (Number(d.amount_satang) || 0) || r.carry_satang !== (Number(d.carry_satang) || 0)) {
        const { error: updErr } = await service
          .from(DED)
          .update({ amount_satang: r.amount_satang, carry_satang: r.carry_satang })
          .eq('id', d.id as string);
        if (updErr) throw updErr;
      }
    }
  }
}
