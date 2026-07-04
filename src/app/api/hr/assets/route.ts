import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager, resolveHrScope } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { bahtToSatang } from '@/lib/pos/money';
import { isForeignKeyViolation, isUniqueViolation } from '@/lib/hr/db-errors';

const TABLE = 'hr_assets';
const NIL_UUID = '00000000-0000-0000-0000-000000000000';
const ALLOWED_STATUSES = ['in_stock', 'issued', 'returned', 'lost', 'damaged'];
const SEARCH_CAP = 500;

const LIST_SELECT =
  'id, name, category, asset_code, holder_id, value_satang, status, issued_date, returned_date, notes, created_at, updated_at, ' +
  'holder:profiles!hr_assets_holder_id_fkey(id, display_name, username)';

// GET /api/hr/assets — list with filters: q (name or asset_code), status, holder_id.
export async function GET(request: NextRequest) {
  // §P5.5: company-wide HR sees every asset; a scoped manager sees only assets held by employees
  // in their stores (the company/unassigned pool stays company-HR-only).
  const scope = await resolveHrScope();
  if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status });

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
  // §P5.5: a scoped manager only sees assets whose holder is an employee in their stores.
  if (scope.storeIds) {
    const { data: us } = await service.from('user_stores').select('user_id').in('store_id', scope.storeIds);
    const holderIds = [...new Set((us ?? []).map((r) => r.user_id as string))];
    query = query.in('holder_id', holderIds.length ? holderIds : [NIL_UUID]);
  }
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

  let valueSatang = 0;
  if ('value_baht' in body) {
    const raw = Number(body.value_baht);
    if (!Number.isFinite(raw) || raw < 0) {
      return NextResponse.json({ error: 'Value must be a non-negative number' }, { status: 400 });
    }
    valueSatang = bahtToSatang(raw);
  }

  let status = 'in_stock';
  if ('status' in body) {
    if (typeof body.status !== 'string' || !ALLOWED_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }
    status = body.status;
  }

  // Effective holder must be consistent with effective status.
  let holderId = typeof body.holder_id === 'string' && body.holder_id ? body.holder_id : null;
  if (status === 'issued' && !holderId) {
    return NextResponse.json({ error: 'An issued asset requires a holder' }, { status: 400 });
  }
  if (status === 'returned' || status === 'in_stock') {
    holderId = null;
  }

  const service = createServiceClient();
  const { data, error } = await service
    .from(TABLE)
    .insert({
      name,
      category: typeof body.category === 'string' && body.category.trim() ? body.category.trim() : null,
      asset_code: typeof body.asset_code === 'string' && body.asset_code.trim() ? body.asset_code.trim() : null,
      holder_id: holderId,
      value_satang: valueSatang,
      status,
      issued_date: typeof body.issued_date === 'string' && body.issued_date ? body.issued_date : null,
      returned_date: typeof body.returned_date === 'string' && body.returned_date ? body.returned_date : null,
      notes: typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null,
      created_by: auth.userId,
    })
    .select('*')
    .single();

  if (error) {
    if (isUniqueViolation(error)) return NextResponse.json({ error: 'Asset code already exists' }, { status: 409 });
    if (isForeignKeyViolation(error)) return NextResponse.json({ error: 'Holder not found' }, { status: 400 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

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
