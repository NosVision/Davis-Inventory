import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { buildEmployeeNameMap } from '@/lib/hr/employee-name-map';

/**
 * Who manages which venue (hr_manager_scopes) — HR's control panel for it.
 *
 * The table has gated store-scoped access since §P5.5 (leaves, warnings, claims, service charge…),
 * but nothing in the app could WRITE it: the only row in production was a test account, so in
 * practice no real manager could approve or schedule anything. Handing venue rosters and leave
 * approval to store managers (owner ask 2026-08-07) needs this first.
 *
 * HR-only on purpose: this grants authority over other people's leave and pay-affecting schedule.
 */
const TABLE = 'hr_manager_scopes';

// GET /api/hr/manager-scopes — every store with the managers assigned to it, plus the accounts
// that can be assigned.
export async function GET() {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const service = createServiceClient();
  const [storesRes, scopesRes, candidatesRes] = await Promise.all([
    service.from('stores').select('id, store_code, store_name').eq('active', true).order('store_name'),
    service.from(TABLE).select('id, user_id, store_id, can_schedule, can_approve, created_at'),
    // Anyone who could plausibly run a venue. Deliberately not restricted to role='manager' —
    // venues are also run by head_bar/hq in this business, and HR should not have to change
    // someone's system role just to let them approve their own team's leave.
    service
      .from('profiles')
      .select('id, username, display_name, role')
      .eq('active', true)
      .in('role', ['manager', 'head_bar', 'hq', 'bar', 'staff', 'accountant'])
      .order('display_name'),
  ]);

  if (storesRes.error || scopesRes.error || candidatesRes.error) {
    return NextResponse.json({ error: 'Failed to load manager scopes' }, { status: 500 });
  }

  const scopes = (scopesRes.data ?? []) as {
    id: string;
    user_id: string;
    store_id: string;
    can_schedule: boolean;
    can_approve: boolean;
  }[];
  const candidates = (candidatesRes.data ?? []) as {
    id: string;
    username: string;
    display_name: string | null;
    role: string;
  }[];

  // Name them the way the rest of HR does: ชื่อจริง (ชื่อเล่น).
  const names = await buildEmployeeNameMap(service, [
    ...scopes.map((s) => s.user_id),
    ...candidates.map((c) => c.id),
  ]);
  const decorate = (id: string, fallback: { username: string; display_name: string | null }) => ({
    name: names.get(id)?.name ?? fallback.display_name ?? fallback.username,
    nickname: names.get(id)?.nickname ?? null,
  });

  const byStore = new Map<string, Array<Record<string, unknown>>>();
  const candidateById = new Map(candidates.map((c) => [c.id, c]));
  for (const s of scopes) {
    const c = candidateById.get(s.user_id);
    const list = byStore.get(s.store_id) ?? [];
    list.push({
      scope_id: s.id,
      user_id: s.user_id,
      username: c?.username ?? null,
      role: c?.role ?? null,
      can_schedule: s.can_schedule,
      can_approve: s.can_approve,
      ...decorate(s.user_id, { username: c?.username ?? '—', display_name: c?.display_name ?? null }),
    });
    byStore.set(s.store_id, list);
  }

  return NextResponse.json({
    data: {
      stores: (storesRes.data ?? []).map((st) => ({
        ...st,
        managers: byStore.get(st.id as string) ?? [],
      })),
      candidates: candidates.map((c) => ({
        id: c.id,
        username: c.username,
        role: c.role,
        ...decorate(c.id, c),
      })),
    },
  });
}

// POST /api/hr/manager-scopes { user_id, store_id } — put someone in charge of a venue.
export async function POST(request: NextRequest) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const userId = typeof body.user_id === 'string' ? body.user_id : '';
  const storeId = typeof body.store_id === 'string' ? body.store_id : '';
  if (!userId || !storeId) {
    return NextResponse.json({ error: 'user_id and store_id are required' }, { status: 400 });
  }

  // Which half of the venue authority this grant carries. Omitting both keeps the original
  // behaviour — a full manager — so anything calling this before the split still works.
  const canSchedule = body.can_schedule === undefined ? true : Boolean(body.can_schedule);
  const canApprove = body.can_approve === undefined ? true : Boolean(body.can_approve);
  if (!canSchedule && !canApprove) {
    return NextResponse.json(
      { error: 'ต้องเลือกอย่างน้อย 1 อย่าง — จัดตารางงาน หรือ อนุมัติ' },
      { status: 400 }
    );
  }

  const service = createServiceClient();
  const { data: target } = await service
    .from('profiles')
    .select('id, username, active, role')
    .eq('id', userId)
    .maybeSingle();
  if (!target) return NextResponse.json({ error: 'ไม่พบบัญชีผู้ใช้นี้' }, { status: 404 });
  if (target.active === false) return NextResponse.json({ error: 'บัญชีนี้ถูกปิดใช้งาน' }, { status: 400 });
  if (target.role === 'customer' || String(target.username ?? '').startsWith('printer-')) {
    return NextResponse.json({ error: 'บัญชีนี้เป็นหัวหน้าสาขาไม่ได้' }, { status: 400 });
  }

  const { data, error } = await service
    .from(TABLE)
    .insert({
      user_id: userId,
      store_id: storeId,
      can_schedule: canSchedule,
      can_approve: canApprove,
      created_by: auth.userId,
    })
    .select('id')
    .single();
  if (error) {
    if ((error as { code?: string }).code === '23505') {
      return NextResponse.json({ error: 'คนนี้เป็นหัวหน้าสาขานี้อยู่แล้ว' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'create',
    table: TABLE,
    recordId: data.id,
    before: null,
    after: { user_id: userId, store_id: storeId, can_schedule: canSchedule, can_approve: canApprove },
    reason:
      `Granted venue authority over store ${storeId} to @${target.username} — ` +
      `${canSchedule ? 'schedule' : ''}${canSchedule && canApprove ? ' + ' : ''}${canApprove ? 'approvals' : ''}`,
  });

  return NextResponse.json({ data }, { status: 201 });
}

// DELETE /api/hr/manager-scopes?id=… — take the venue back off them.
export async function DELETE(request: NextRequest) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const id = request.nextUrl.searchParams.get('id') ?? '';
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const service = createServiceClient();
  const { data: before } = await service.from(TABLE).select('*').eq('id', id).maybeSingle();
  if (!before) return NextResponse.json({ error: 'ไม่พบรายการนี้' }, { status: 404 });

  const { error } = await service.from(TABLE).delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'delete',
    table: TABLE,
    recordId: id,
    before: before as Record<string, unknown>,
    after: null,
    reason: 'Revoked venue management',
  });

  return NextResponse.json({ success: true });
}
