import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';

const TABLE = 'hr_eval_assignment_templates';
const MAX_PAIRS = 4000;

interface Pair { evaluator_id: string; employee_id: string }

// Normalize + validate an incoming pairs array: keep well-formed, non-self, de-duplicated pairs.
function cleanPairs(raw: unknown): Pair[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Pair[] = [];
  for (const p of raw) {
    if (!p || typeof p !== 'object') continue;
    const ev = (p as Record<string, unknown>).evaluator_id;
    const em = (p as Record<string, unknown>).employee_id;
    if (typeof ev !== 'string' || typeof em !== 'string' || !ev || !em || ev === em) continue;
    const key = `${ev}|${em}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ evaluator_id: ev, employee_id: em });
  }
  return out;
}

// GET /api/hr/eval/templates?store_id= — reusable assignment templates for a store (§Phase 4).
export async function GET(request: NextRequest) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const storeId = request.nextUrl.searchParams.get('store_id') ?? '';
  if (!storeId) return NextResponse.json({ error: 'store_id is required' }, { status: 400 });

  const service = createServiceClient();
  const { data, error } = await service
    .from(TABLE)
    .select('id, store_id, name, pairs, created_at')
    .eq('store_id', storeId)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []).map((t) => ({
    id: t.id as string,
    store_id: t.store_id as string,
    name: t.name as string,
    pair_count: Array.isArray(t.pairs) ? (t.pairs as unknown[]).length : 0,
    created_at: t.created_at as string,
  }));
  return NextResponse.json({ data: rows });
}

// POST /api/hr/eval/templates { store_id, name, pairs:[{evaluator_id, employee_id}] } — save the
// current "who evaluates whom" matrix as a reusable template for a store.
export async function POST(request: NextRequest) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const storeId = typeof body.store_id === 'string' ? body.store_id : '';
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : '';
  const pairs = cleanPairs(body.pairs);

  if (!storeId) return NextResponse.json({ error: 'store_id is required' }, { status: 400 });
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
  if (pairs.length === 0) return NextResponse.json({ error: 'at least one valid pair is required' }, { status: 400 });
  if (pairs.length > MAX_PAIRS) return NextResponse.json({ error: `too many pairs (${pairs.length})` }, { status: 400 });

  const service = createServiceClient();
  const { data, error } = await service
    .from(TABLE)
    .insert({ store_id: storeId, name, pairs, created_by: auth.userId })
    .select('id, store_id, name, pairs, created_at')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logHrAudit(service, {
    actorId: auth.userId, action: 'create', table: TABLE, recordId: data.id as string,
    before: null, after: { store_id: storeId, name, pairs: pairs.length }, reason: 'eval assignment template saved',
  });
  return NextResponse.json({ data: { id: data.id, name: data.name, pair_count: pairs.length } }, { status: 201 });
}
