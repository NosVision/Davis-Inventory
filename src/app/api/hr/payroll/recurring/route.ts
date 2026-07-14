import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManagerForStore } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { RECURRING_CODES, MAX_ITEM_AMOUNT_SATANG, parsePeriodInput } from '@/lib/hr/recurring';

const TABLE = 'hr_employee_recurring';
const ITEM_COLS = 'id, employee_id, kind, code, label, amount_satang, active, note, start_period, end_period';
const KINDS = ['earning', 'deduction'];
const BULK_MAX = 200;

// Company-wide recurring-items surface for the /hr/payroll/recurring grid. Full HR only —
// this is the all-employees money-config view (a store-scoped manager uses the per-employee
// modal on the payroll page instead).

// GET /api/hr/payroll/recurring?company_id= — every employee of the company (active/probation)
// plus all their recurring rows, one payload for the grid.
export async function GET(request: NextRequest) {
  const auth = await requireHrManagerForStore(null);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const companyId = request.nextUrl.searchParams.get('company_id') ?? '';
  if (!companyId) return NextResponse.json({ error: 'company_id is required' }, { status: 400 });

  const service = createServiceClient();
  const { data: empRows, error: empErr } = await service
    .from('hr_employees')
    .select(
      'id, profile_id, status, ' +
        'profile:profiles!hr_employees_profile_id_fkey(display_name, username), ' +
        'position:hr_positions(name)'
    )
    .eq('company_id', companyId)
    .in('status', ['active', 'probation'])
    .order('created_at', { ascending: true });
  if (empErr) return NextResponse.json({ error: 'Failed to load employees' }, { status: 500 });

  interface EmpRow {
    id: string;
    profile_id: string;
    status: string;
    profile: { display_name: string | null; username: string | null } | null;
    position: { name: string | null } | null;
  }
  const employees = ((empRows ?? []) as unknown as EmpRow[]).map((e) => ({
    id: e.id,
    profile_id: e.profile_id,
    name: e.profile?.display_name || e.profile?.username || '—',
    position: e.position?.name ?? null,
    status: e.status,
  }));

  const empIds = employees.map((e) => e.id);
  let items: Record<string, unknown>[] = [];
  if (empIds.length > 0) {
    const { data: itemRows, error: itemErr } = await service
      .from(TABLE)
      .select(ITEM_COLS)
      .in('employee_id', empIds)
      .order('created_at', { ascending: true });
    if (itemErr) return NextResponse.json({ error: 'Failed to load recurring items' }, { status: 500 });
    items = itemRows ?? [];
  }

  return NextResponse.json({ data: { employees, items } });
}

// POST /api/hr/payroll/recurring — bulk add: the same item to N employees in one shot
// (e.g. travel allowance ฿1,000 for 20 people, perpetual). Audited once with the id list.
export async function POST(request: NextRequest) {
  const auth = await requireHrManagerForStore(null);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const companyId = typeof body.company_id === 'string' ? body.company_id : '';
  const employeeIds = Array.isArray(body.employee_ids)
    ? body.employee_ids.filter((v): v is string => typeof v === 'string' && v.length > 0)
    : [];
  const kind = typeof body.kind === 'string' ? body.kind : '';
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  const label = typeof body.label === 'string' ? body.label.trim() : '';
  const amount = Number(body.amount_satang);
  const note = typeof body.note === 'string' ? body.note.slice(0, 300) : null;

  if (!companyId) return NextResponse.json({ error: 'company_id is required' }, { status: 400 });
  if (employeeIds.length === 0) return NextResponse.json({ error: 'employee_ids is required' }, { status: 400 });
  if (employeeIds.length > BULK_MAX) {
    return NextResponse.json({ error: `at most ${BULK_MAX} employees per bulk add` }, { status: 400 });
  }
  if (!KINDS.includes(kind)) return NextResponse.json({ error: 'kind must be earning or deduction' }, { status: 400 });
  if (!RECURRING_CODES.includes(code)) return NextResponse.json({ error: 'invalid code' }, { status: 400 });
  if (!label) return NextResponse.json({ error: 'label is required' }, { status: 400 });
  if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_ITEM_AMOUNT_SATANG) {
    return NextResponse.json({ error: 'amount_satang must be a positive integer within the allowed range' }, { status: 400 });
  }
  const periods = parsePeriodInput(body);
  if (!periods.ok) return NextResponse.json({ error: periods.error }, { status: 400 });

  const service = createServiceClient();
  // Every target must be an employee of THIS company — a stray id must fail loudly, not insert.
  const { data: empRows, error: empErr } = await service
    .from('hr_employees')
    .select('id')
    .eq('company_id', companyId)
    .in('id', employeeIds);
  if (empErr) return NextResponse.json({ error: 'Failed to verify employees' }, { status: 500 });
  const validIds = new Set((empRows ?? []).map((e) => e.id as string));
  const invalid = employeeIds.filter((id) => !validIds.has(id));
  if (invalid.length > 0) {
    return NextResponse.json({ error: `${invalid.length} employee(s) not in this company` }, { status: 400 });
  }

  const rows = employeeIds.map((employeeId) => ({
    employee_id: employeeId,
    kind, code, label, amount_satang: amount, note,
    start_period: periods.start_period, end_period: periods.end_period,
    created_by: auth.userId,
  }));
  const { data, error } = await service.from(TABLE).insert(rows).select(ITEM_COLS);
  if (error) return NextResponse.json({ error: 'Failed to add recurring items' }, { status: 500 });

  await logHrAudit(service, {
    actorId: auth.userId, action: 'create', table: TABLE, recordId: companyId,
    before: null,
    after: { kind, code, label, amount_satang: amount, start_period: periods.start_period, end_period: periods.end_period, employees: employeeIds.length },
    reason: `bulk recurring item added (${employeeIds.length} employees)`,
  });
  return NextResponse.json({ data: data ?? [] }, { status: 201 });
}
