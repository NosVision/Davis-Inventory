import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';

const TABLE = 'hr_assets';
const NIL_UUID = '00000000-0000-0000-0000-000000000000';
const ALLOWED_STATUSES = ['in_stock', 'issued', 'returned', 'lost', 'damaged'];
const SEARCH_CAP = 500;

const LIST_SELECT =
  'id, name, category, asset_code, holder_id, value_satang, status, issued_date, returned_date, notes, created_at, updated_at, ' +
  'holder:profiles!hr_assets_holder_id_fkey(id, display_name, username)';

// GET /api/hr/assets — list with filters: q (name or asset_code), status, holder_id.
export async function GET(request: NextRequest) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const sp = request.nextUrl.searchParams;
  const q = (sp.get('q') ?? '').trim();
  const status = sp.get('status');
  const holderId = sp.get('holder_id');

  const service = createServiceClient();

  // Safe, parameterized search on name OR asset_code via two prefetches (avoids raw .or filter).
  let idFilter: string[] | null = null;
  if (q) {
    const like = `%${q}%`;
    const [byName, byCode] = await Promise.all([
      service.from(TABLE).select('id').ilike('name', like).limit(SEARCH_CAP),
      service.from(TABLE).select('id').ilike('asset_code', like).limit(SEARCH_CAP),
    ]);
    if (byName.error || byCode.error) {
      return NextResponse.json({ error: 'Search failed' }, { status: 500 });
    }
    const set = new Set<string>();
    (byName.data ?? []).forEach((r) => set.add(r.id as string));
    (byCode.data ?? []).forEach((r) => set.add(r.id as string));
    idFilter = [...set];
  }

  let query = service.from(TABLE).select(LIST_SELECT);
  if (status) query = query.eq('status', status);
  if (holderId) query = query.eq('holder_id', holderId);
  if (idFilter) query = query.in('id', idFilter.length ? idFilter : [NIL_UUID]);
  query = query.order('created_at', { ascending: false });

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data ?? [] });
}

// POST /api/hr/assets — create an asset.
export async function POST(request: NextRequest) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

  const valueSatang = Math.round((Number(body.value_baht) || 0) * 100);
  const status =
    typeof body.status === 'string' && ALLOWED_STATUSES.includes(body.status) ? body.status : 'in_stock';

  const service = createServiceClient();
  const { data, error } = await service
    .from(TABLE)
    .insert({
      name,
      category: typeof body.category === 'string' && body.category.trim() ? body.category.trim() : null,
      asset_code: typeof body.asset_code === 'string' && body.asset_code.trim() ? body.asset_code.trim() : null,
      holder_id: typeof body.holder_id === 'string' && body.holder_id ? body.holder_id : null,
      value_satang: valueSatang,
      status,
      issued_date: typeof body.issued_date === 'string' && body.issued_date ? body.issued_date : null,
      returned_date: typeof body.returned_date === 'string' && body.returned_date ? body.returned_date : null,
      notes: typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null,
      created_by: auth.userId,
    })
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'create',
    table: TABLE,
    recordId: data.id,
    before: null,
    after: data,
  });

  return NextResponse.json(data, { status: 201 });
}
