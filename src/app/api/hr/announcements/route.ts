import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';

const TABLE = 'hr_announcements';
const STORES_TABLE = 'hr_announcement_stores';
const RECEIPTS_TABLE = 'hr_announcement_receipts';

// GET /api/hr/announcements — all announcements (active + inactive) for management,
// each stitched with its scope (`store_ids`; empty = company-wide) and `acked_count`
// (receipts that have actually been acknowledged).
export async function GET() {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const service = createServiceClient();
  const { data: anns, error } = await service
    .from(TABLE)
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = anns ?? [];
  const ids = rows.map((a) => a.id as string);

  const storeByAnn = new Map<string, string[]>();
  const ackedByAnn = new Map<string, number>();

  if (ids.length > 0) {
    const [storesRes, receiptsRes] = await Promise.all([
      service.from(STORES_TABLE).select('announcement_id, store_id').in('announcement_id', ids),
      service
        .from(RECEIPTS_TABLE)
        .select('announcement_id')
        .in('announcement_id', ids)
        .not('acknowledged_at', 'is', null),
    ]);

    if (storesRes.error)
      return NextResponse.json({ error: storesRes.error.message }, { status: 500 });
    if (receiptsRes.error)
      return NextResponse.json({ error: receiptsRes.error.message }, { status: 500 });

    for (const s of storesRes.data ?? []) {
      const annId = s.announcement_id as string;
      const list = storeByAnn.get(annId) ?? [];
      list.push(s.store_id as string);
      storeByAnn.set(annId, list);
    }
    for (const r of receiptsRes.data ?? []) {
      const annId = r.announcement_id as string;
      ackedByAnn.set(annId, (ackedByAnn.get(annId) ?? 0) + 1);
    }
  }

  const data = rows.map((a) => ({
    ...a,
    store_ids: storeByAnn.get(a.id as string) ?? [],
    acked_count: ackedByAnn.get(a.id as string) ?? 0,
  }));

  return NextResponse.json({ data });
}

// POST /api/hr/announcements — create an announcement { title, body?, storeIds? }.
// A non-empty storeIds scopes the announcement to those branches; empty/omitted =
// company-wide (no join rows).
export async function POST(request: NextRequest) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) return NextResponse.json({ error: 'Title is required' }, { status: 400 });

  const messageBody = typeof body.body === 'string' ? body.body : null;
  const storeIds = Array.isArray(body.storeIds)
    ? body.storeIds.filter((s): s is string => typeof s === 'string')
    : [];

  const service = createServiceClient();
  const { data, error } = await service
    .from(TABLE)
    .insert({
      title,
      body: messageBody,
      active: true,
      created_by: auth.userId,
    })
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (storeIds.length > 0) {
    const { error: scopeErr } = await service
      .from(STORES_TABLE)
      .insert(storeIds.map((store_id) => ({ announcement_id: data.id, store_id })));
    if (scopeErr) return NextResponse.json({ error: scopeErr.message }, { status: 500 });
  }

  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'create',
    table: TABLE,
    recordId: data.id,
    before: null,
    after: data,
  });

  return NextResponse.json({ ...data, store_ids: storeIds, acked_count: 0 }, { status: 201 });
}
