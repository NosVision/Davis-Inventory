import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

/**
 * POS rows that the comparison never shows — the ones HQ asked to see (owner ask 2026-08-14).
 *
 * A negative quantity in the POS file means POS sold more of something than it ever had: the
 * balance ran through zero and kept going. That is exactly the row worth looking at, and it is
 * the one row the system was structurally guaranteed to hide:
 *
 *   • Products with count_status='excluded' are skipped outright by /api/stock/compare — the rule
 *     exists so beer kegs and snacks aren't flagged as -100% for having no manual count, but it
 *     swallowed genuine negatives with them.
 *   • Deactivated products (active=false) are off the count sheet, so staff never enter a number.
 *     They can only ever land in the comparison as a POS-only row, and the whole POS-only backlog
 *     was accepted in bulk on 2026-08-07 (migration 00180).
 *   • And if nobody ran the comparison for that date at all, there is no row anywhere. This is not
 *     hypothetical: House of Savoy 2026-05-28 uploaded 30 negative lines and has zero comparison
 *     rows for the date.
 *
 * So this reads ocr_items directly rather than comparisons. It does not depend on the comparison
 * having been generated, on the product being active, or on anyone having counted it — which is
 * the point, because every one of those conditions is what made the rows invisible.
 *
 * Read-only. It reports; it does not change a status or ask anyone for an explanation.
 */

const VIEW_ROLES = ['owner', 'accountant', 'hq', 'manager'];

export interface PosNegativeRow {
  product_code: string;
  product_name: string | null;
  qty_ocr: number;
  /** null when the POS code has no product record at all. */
  active: boolean | null;
  count_status: string | null;
  /** Why the comparison never surfaced it — what HQ actually wants to know. */
  hidden_reason: 'excluded' | 'inactive' | 'not_in_products' | 'no_comparison' | 'visible';
}

// GET /api/stock/pos-negatives?store_id=&date=YYYY-MM-DD
// Omit `date` to sweep every upload the store has ever made.
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const service = createServiceClient();
  const { data: profile } = await service
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile || !VIEW_ROLES.includes(profile.role as string)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const storeId = request.nextUrl.searchParams.get('store_id');
  const date = request.nextUrl.searchParams.get('date');
  if (!storeId) {
    return NextResponse.json({ error: 'store_id is required' }, { status: 400 });
  }

  // Every upload for the store (or the one day asked for). Taking all logs for a date rather than
  // only the newest: a re-upload replaces what the comparison reads, but a negative line in an
  // earlier file still happened and HQ should not lose it to a later correction.
  let logQuery = service
    .from('ocr_logs')
    .select('id, upload_date')
    .eq('store_id', storeId)
    .order('upload_date', { ascending: false });
  if (date) {
    logQuery = logQuery
      .gte('upload_date', `${date}T00:00:00`)
      .lt('upload_date', `${date}T23:59:59.999`);
  }
  const { data: logs, error: logError } = await logQuery;
  if (logError) {
    return NextResponse.json({ error: 'Failed to load POS uploads' }, { status: 500 });
  }
  if (!logs?.length) return NextResponse.json({ data: { rows: [], dates: [] } });

  const logDate = new Map<string, string>();
  for (const l of logs) logDate.set(l.id as string, (l.upload_date as string).slice(0, 10));

  const { data: items, error: itemError } = await service
    .from('ocr_items')
    .select('ocr_log_id, product_code, qty_ocr')
    .in('ocr_log_id', Array.from(logDate.keys()))
    .lt('qty_ocr', 0);
  if (itemError) {
    return NextResponse.json({ error: 'Failed to load POS items' }, { status: 500 });
  }
  if (!items?.length) return NextResponse.json({ data: { rows: [], dates: [] } });

  const codes = Array.from(new Set(items.map((i) => i.product_code as string)));
  const { data: products } = await service
    .from('products')
    .select('product_code, product_name, active, count_status')
    .eq('store_id', storeId)
    .in('product_code', codes);

  const productByCode = new Map(
    (products ?? []).map((p) => [p.product_code as string, p])
  );

  // Which (date, code) pairs did reach the comparison table — anything present there is already
  // visible to staff and is reported as such rather than claimed as a hidden row.
  const affectedDates = Array.from(new Set(Array.from(logDate.values())));
  const { data: seen } = await service
    .from('comparisons')
    .select('comp_date, product_code')
    .eq('store_id', storeId)
    .in('comp_date', affectedDates)
    .in('product_code', codes);
  const inComparison = new Set(
    (seen ?? []).map((c) => `${c.comp_date}|${c.product_code}`)
  );

  const rows = items.map((i) => {
    const code = i.product_code as string;
    const d = logDate.get(i.ocr_log_id as string)!;
    const p = productByCode.get(code);

    let hidden: PosNegativeRow['hidden_reason'];
    if (inComparison.has(`${d}|${code}`)) hidden = 'visible';
    else if (!p) hidden = 'not_in_products';
    else if (p.count_status === 'excluded') hidden = 'excluded';
    else if (p.active === false) hidden = 'inactive';
    else hidden = 'no_comparison';

    return {
      date: d,
      product_code: code,
      product_name: (p?.product_name as string) ?? null,
      qty_ocr: Number(i.qty_ocr),
      active: p ? ((p.active as boolean) ?? null) : null,
      count_status: p ? ((p.count_status as string) ?? null) : null,
      hidden_reason: hidden,
    };
  });

  // Countable stock first, then worst shortfall.
  //
  // Sorting on quantity alone buries the finding. Baccarat's 2026-08-14 file carries 44 negative
  // lines, and the largest are soft drinks counted in a different unit entirely — Schweppes at
  // -271,470 and Coke at -217,865, against Grey Goose Vodka at -46.80. Those products are marked
  // "ไม่ต้องนับ" precisely because their POS numbers are not stock figures, so letting them head
  // the list would put six-figure noise above the bottle HQ is actually asking about.
  const countable = (r: { count_status: string | null }) => r.count_status !== 'excluded';
  rows.sort((a, b) => {
    if (countable(a) !== countable(b)) return countable(a) ? -1 : 1;
    return a.qty_ocr - b.qty_ocr;
  });

  return NextResponse.json({
    data: {
      rows,
      dates: affectedDates.sort().reverse(),
    },
  });
}
