import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager, resolveHrScope } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { todayBangkok } from '@/lib/utils/date';

const TABLE = 'hr_leave_balances';
const NIL_UUID = '00000000-0000-0000-0000-000000000000';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIN_YEAR = 2000;
const MAX_YEAR = 2200;
const MAX_QUOTA_DAYS = 366;

interface QuotaEmployee {
  employee_id: string;
  profile_id: string;
  name: string;
  position: string | null;
}

interface UsedEntry {
  user_id: string;
  leave_type_id: string;
  /** 1-12 (month of from_date, Bangkok calendar dates) */
  month: number;
  days: number;
}

function parseYear(raw: string | null): number | null {
  if (!raw) return Number(todayBangkok().slice(0, 4));
  const year = Number(raw);
  if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) return null;
  return year;
}

// GET /api/hr/leaves/quota?company_id?&year? — the quota & usage matrix for /hr/leaves.
// `company_id` is OPTIONAL: the approval queue is cross-company for full HR, so omitting it
// returns every company's active employees/types the caller can see. A store-scoped manager
// (resolveHrScope → storeIds array) only sees employees whose user_stores intersect their scope.
export async function GET(request: NextRequest) {
  const scope = await resolveHrScope();
  if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status });

  const sp = request.nextUrl.searchParams;
  const companyId = sp.get('company_id') ?? '';
  if (companyId && !UUID_RE.test(companyId)) {
    return NextResponse.json({ error: 'Invalid company_id' }, { status: 400 });
  }
  const year = parseYear(sp.get('year'));
  if (year === null) return NextResponse.json({ error: 'Invalid year' }, { status: 400 });

  const service = createServiceClient();

  // Active leave types, ordered for display. With a company: shared (NULL) + that company's.
  let typesQuery = service
    .from('hr_leave_types')
    .select('id, code, name_th, name_en, annual_quota_days')
    .eq('active', true)
    .order('sort_order', { ascending: true });
  if (companyId) typesQuery = typesQuery.or(`company_id.is.null,company_id.eq.${companyId}`);
  const { data: typeRows, error: typesErr } = await typesQuery;
  if (typesErr) return NextResponse.json({ error: 'Failed to load leave types' }, { status: 500 });
  const types = (typeRows ?? []).map((t) => ({
    id: t.id as string,
    code: t.code as string,
    name_th: t.name_th as string,
    name_en: t.name_en as string,
    annual_quota_days: t.annual_quota_days == null ? null : Number(t.annual_quota_days),
  }));

  // §P5.5: a scoped manager only sees employees whose user_stores intersect their stores.
  let scopeProfileIds: string[] | null = null;
  if (scope.storeIds) {
    const { data: us, error: usErr } = await service
      .from('user_stores')
      .select('user_id')
      .in('store_id', scope.storeIds);
    if (usErr) return NextResponse.json({ error: 'Scope filter failed' }, { status: 500 });
    scopeProfileIds = [...new Set((us ?? []).map((r) => r.user_id as string))];
  }

  let empQuery = service
    .from('hr_employees')
    .select(
      'id, profile_id, full_name, ' +
        'profile:profiles!hr_employees_profile_id_fkey(display_name, username), ' +
        'position:hr_positions(name)'
    )
    .in('status', ['active', 'probation']);
  if (companyId) empQuery = empQuery.eq('company_id', companyId);
  if (scopeProfileIds) {
    empQuery = empQuery.in('profile_id', scopeProfileIds.length ? scopeProfileIds : [NIL_UUID]);
  }
  const { data: empRows, error: empErr } = await empQuery;
  if (empErr) return NextResponse.json({ error: 'Failed to load employees' }, { status: 500 });

  const employees: QuotaEmployee[] = (empRows ?? [])
    .map((row) => {
      const r = row as unknown as {
        id: string;
        profile_id: string;
        full_name: string | null;
        profile: { display_name: string | null; username: string | null } | null;
        position: { name: string | null } | null;
      };
      return {
        employee_id: r.id,
        profile_id: r.profile_id,
        name: r.full_name || r.profile?.display_name || r.profile?.username || '—',
        position: r.position?.name ?? null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'th'));

  const employeeIds = employees.map((e) => e.employee_id);
  const profileIds = employees.map((e) => e.profile_id);

  // Per-employee quota overrides for the year (effective quota = balance ?? annual_quota_days).
  let balances: Array<{ employee_id: string; leave_type_id: string; quota_days: number }> = [];
  if (employeeIds.length) {
    const { data, error } = await service
      .from(TABLE)
      .select('employee_id, leave_type_id, quota_days')
      .in('employee_id', employeeIds)
      .eq('year', year);
    if (error) return NextResponse.json({ error: 'Failed to load quota overrides' }, { status: 500 });
    balances = (data ?? []).map((b) => ({
      employee_id: b.employee_id as string,
      leave_type_id: b.leave_type_id as string,
      quota_days: Number(b.quota_days),
    }));
  }

  // Approved usage in the year, aggregated server-side per user × type × month.
  let used: UsedEntry[] = [];
  if (profileIds.length) {
    const { data, error } = await service
      .from('hr_leaves')
      .select('user_id, leave_type_id, from_date, days')
      .eq('status', 'approved')
      .in('user_id', profileIds)
      .gte('from_date', `${year}-01-01`)
      .lte('from_date', `${year}-12-31`);
    if (error) return NextResponse.json({ error: 'Failed to load leave usage' }, { status: 500 });
    const agg = new Map<string, UsedEntry>();
    for (const row of data ?? []) {
      const userId = row.user_id as string;
      const leaveTypeId = row.leave_type_id as string;
      const month = Number(String(row.from_date).slice(5, 7));
      if (!(month >= 1 && month <= 12)) continue;
      const days = Number(row.days ?? 0);
      const key = `${userId}|${leaveTypeId}|${month}`;
      const prev = agg.get(key);
      agg.set(
        key,
        prev
          ? { ...prev, days: Math.round((prev.days + days) * 10) / 10 }
          : { user_id: userId, leave_type_id: leaveTypeId, month, days }
      );
    }
    used = [...agg.values()];
  }

  return NextResponse.json({ data: { year, types, employees, balances, used } });
}

// PUT /api/hr/leaves/quota — full HR only. Sets (or clears) one employee's per-year quota
// override for a leave type. quota_days: 0–366 → upsert; null/'' → delete the override
// (falls back to the type's annual_quota_days). Every change is audited before→after.
export async function PUT(request: NextRequest) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const employeeId = typeof body.employee_id === 'string' ? body.employee_id : '';
  const leaveTypeId = typeof body.leave_type_id === 'string' ? body.leave_type_id : '';
  const year = Number(body.year);
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null;

  if (!UUID_RE.test(employeeId) || !UUID_RE.test(leaveTypeId)) {
    return NextResponse.json({ error: 'employee_id and leave_type_id are required' }, { status: 400 });
  }
  if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) {
    return NextResponse.json({ error: 'Invalid year' }, { status: 400 });
  }

  // quota_days: null/'' clears the override; otherwise a number 0–366 (numeric(5,1) → 1 decimal).
  const raw = body.quota_days;
  const isClear = raw == null || raw === '';
  let quotaDays: number | null = null;
  if (!isClear) {
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > MAX_QUOTA_DAYS) {
      return NextResponse.json(
        { error: `quota_days must be a number between 0 and ${MAX_QUOTA_DAYS}` },
        { status: 400 }
      );
    }
    quotaDays = Math.round(n * 10) / 10;
  }

  const service = createServiceClient();

  const { data: emp, error: empErr } = await service
    .from('hr_employees')
    .select('id')
    .eq('id', employeeId)
    .maybeSingle();
  if (empErr) return NextResponse.json({ error: 'Failed to load employee' }, { status: 500 });
  if (!emp) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });

  // Before-snapshot for the audit trail (and to know create vs update vs no-op delete).
  const { data: before, error: beforeErr } = await service
    .from(TABLE)
    .select('*')
    .eq('employee_id', employeeId)
    .eq('leave_type_id', leaveTypeId)
    .eq('year', year)
    .maybeSingle();
  if (beforeErr) return NextResponse.json({ error: 'Failed to load current quota' }, { status: 500 });
  const beforeRow = before as ({ id: string } & Record<string, unknown>) | null;

  if (isClear) {
    if (!beforeRow) return NextResponse.json({ data: null });
    const { error: delErr } = await service.from(TABLE).delete().eq('id', beforeRow.id);
    if (delErr) return NextResponse.json({ error: 'Failed to clear quota' }, { status: 500 });
    await logHrAudit(service, {
      actorId: auth.userId,
      action: 'delete',
      table: TABLE,
      recordId: beforeRow.id,
      before: beforeRow,
      after: null,
      reason: note ?? `Cleared leave quota override (${year})`,
    });
    return NextResponse.json({ data: null });
  }

  const { data: saved, error: upErr } = await service
    .from(TABLE)
    .upsert(
      {
        employee_id: employeeId,
        leave_type_id: leaveTypeId,
        year,
        quota_days: quotaDays,
        note,
        updated_by: auth.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'employee_id,leave_type_id,year' }
    )
    .select('*')
    .single();
  if (upErr) {
    // 23503 = FK violation (bad leave_type_id) — a client error, not a server one.
    if ((upErr as { code?: string }).code === '23503') {
      return NextResponse.json({ error: 'Leave type not found' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Failed to save quota' }, { status: 500 });
  }

  const savedRow = saved as { id: string } & Record<string, unknown>;
  await logHrAudit(service, {
    actorId: auth.userId,
    action: beforeRow ? 'update' : 'create',
    table: TABLE,
    recordId: savedRow.id,
    before: beforeRow,
    after: savedRow,
    reason: note ?? `Set leave quota ${quotaDays} days (${year})`,
  });

  return NextResponse.json({ data: savedRow });
}
