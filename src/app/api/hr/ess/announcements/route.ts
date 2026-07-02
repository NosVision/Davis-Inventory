import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { todayBangkok } from '@/lib/utils/date';

// GET /api/hr/ess/announcements — employee self-service.
// Any authenticated user may read the announcements that are "pending today" for
// them. NOT gated by requireHrManager — this is ESS, reachable by every employee.
//
// Scope: an announcement is "for me" when it is active AND (it has no
// hr_announcement_stores rows [company-wide] OR one of its store rows is in my
// user_stores). It is "pending today" when it is for me AND I have no receipt
// with acknowledged_at set AND (no receipt OR the receipt's snoozed_date is null
// OR snoozed_date < todayBangkok()). Snoozing hides it only for the snoozed
// business day; once todayBangkok advances past snoozed_date it re-appears.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const service = createServiceClient();

  // (1) My store ids.
  const { data: storeRows, error: storesErr } = await service
    .from('user_stores')
    .select('store_id')
    .eq('user_id', user.id);
  if (storesErr) {
    return NextResponse.json({ error: storesErr.message }, { status: 500 });
  }
  const myStoreIds = new Set((storeRows ?? []).map((r) => r.store_id as string));

  // (2) Active announcements, newest first.
  const { data: annRows, error: annErr } = await service
    .from('hr_announcements')
    .select('id,title,body,created_at')
    .eq('active', true)
    .order('created_at', { ascending: false });
  if (annErr) {
    return NextResponse.json({ error: annErr.message }, { status: 500 });
  }
  const announcements = annRows ?? [];
  if (announcements.length === 0) {
    return NextResponse.json({ data: [] });
  }

  const annIds = announcements.map((a) => a.id as string);

  // (3) Their store scope rows + (4) my receipts, in parallel.
  const [scopeRes, receiptRes] = await Promise.all([
    service
      .from('hr_announcement_stores')
      .select('announcement_id,store_id')
      .in('announcement_id', annIds)
      .limit(5000),
    service
      .from('hr_announcement_receipts')
      .select('announcement_id,acknowledged_at,snoozed_date')
      .eq('user_id', user.id)
      .in('announcement_id', annIds)
      .limit(5000),
  ]);
  if (scopeRes.error) {
    return NextResponse.json({ error: scopeRes.error.message }, { status: 500 });
  }
  if (receiptRes.error) {
    return NextResponse.json({ error: receiptRes.error.message }, { status: 500 });
  }

  // announcement_id -> set of store_ids (presence of any row = store-scoped).
  const scopeByAnn = new Map<string, Set<string>>();
  for (const row of scopeRes.data ?? []) {
    const annId = row.announcement_id as string;
    const set = scopeByAnn.get(annId) ?? new Set<string>();
    set.add(row.store_id as string);
    scopeByAnn.set(annId, set);
  }

  // announcement_id -> my receipt.
  const receiptByAnn = new Map<
    string,
    { acknowledged_at: string | null; snoozed_date: string | null }
  >();
  for (const row of receiptRes.data ?? []) {
    receiptByAnn.set(row.announcement_id as string, {
      acknowledged_at: (row.acknowledged_at as string | null) ?? null,
      snoozed_date: (row.snoozed_date as string | null) ?? null,
    });
  }

  const today = todayBangkok();

  const data = announcements
    .filter((a) => {
      const id = a.id as string;

      // Scope: company-wide (no store rows) OR at least one store row is mine.
      const stores = scopeByAnn.get(id);
      const forMe =
        !stores ||
        stores.size === 0 ||
        [...stores].some((storeId) => myStoreIds.has(storeId));
      if (!forMe) return false;

      // Pending: not acknowledged AND not snoozed for today.
      const receipt = receiptByAnn.get(id);
      if (receipt?.acknowledged_at) return false;
      return !receipt || !receipt.snoozed_date || receipt.snoozed_date < today;
    })
    .map((a) => ({ id: a.id as string, title: a.title as string, body: a.body as string | null }));

  return NextResponse.json({ data });
}
