import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Generate a transfer code in format `TRF-{STORE_CODE}-{YYMMDD}-{NNNN}`,
 * sequential per source store per day, Asia/Bangkok timezone.
 *
 * The store_code prefix is what makes the code globally unique by
 * construction — two stores clicking "transfer" at the same moment
 * land in different `prefix` buckets and can't collide. Within a
 * single store the count-then-write race still exists, but the
 * realistic blast radius (one shop's clerk double-tapping) is small
 * enough to live with; collisions are caught by the per-batch grouping
 * on the HQ side until we add a real DB sequence.
 *
 * @param fromStoreId  UUID of the source store; we look up store_code
 *                     ourselves so the caller doesn't have to.
 */
export async function generateTransferCode(
  supabase: SupabaseClient,
  fromStoreId: string,
): Promise<string> {
  // 1. Resolve store_code so we can include it in the prefix.
  const { data: store } = await supabase
    .from('stores')
    .select('store_code')
    .eq('id', fromStoreId)
    .single();
  // Fall back to a literal "XXX" so a misconfigured store at least
  // produces a clearly-wrong code instead of an SQL exception.
  const storeCode = store?.store_code || 'XXX';

  // 2. Bangkok-local YYMMDD. Using the sv-SE locale gives ISO-style
  // YYYY-MM-DD which we strip down to YYMMDD.
  const dateStr = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Bangkok' })
    .format(new Date())
    .replace(/-/g, '')
    .slice(2);

  // 3. Per-store-per-day sequence. The prefix carries store_code now,
  // so the count is automatically scoped to this one store on this one
  // day. Cross-store races become impossible.
  const prefix = `TRF-${storeCode}-${dateStr}-`;
  const { count } = await supabase
    .from('transfers')
    .select('*', { count: 'exact', head: true })
    .like('transfer_code', `${prefix}%`);

  const seq = String((count || 0) + 1).padStart(4, '0');
  return `${prefix}${seq}`;
}
