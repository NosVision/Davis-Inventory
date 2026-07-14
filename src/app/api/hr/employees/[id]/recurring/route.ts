import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManagerForEmployeeId } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { RECURRING_CODES, PERIOD_RE, parsePeriodInput } from '@/lib/hr/recurring';

const KINDS = ['earning', 'deduction'];
const TABLE = 'hr_employee_recurring';
const COLS = 'id, employee_id, kind, code, label, amount_satang, active, note, start_period, end_period';

// Per-employee recurring monthly payroll items (allowances = earnings; fixed deductions).
// HR only — these feed the payroll engine, so they are salary-sensitive. [id] = hr_employees.id.
// v2 (00162): items carry an optional period window ('YYYY-MM'); null end_period = perpetual.

// GET /api/hr/employees/[id]/recurring — list the employee's recurring items.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireHrManagerForEmployeeId(id);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const service = createServiceClient();
  const { data, error } = await service.from(TABLE).select(COLS).eq('employee_id', id).order('kind').order('code');
  if (error) return NextResponse.json({ error: 'Failed to load recurring items' }, { status: 500 });
  return NextResponse.json({ data: data ?? [] });
}

// POST /api/hr/employees/[id]/recurring — add a recurring item. Audited.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireHrManagerForEmployeeId(id);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const kind = typeof body.kind === 'string' ? body.kind : '';
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  const label = typeof body.label === 'string' ? body.label.trim() : '';
  const amount = Number(body.amount_satang);
  const note = typeof body.note === 'string' ? body.note.slice(0, 300) : null;
  if (!KINDS.includes(kind)) return NextResponse.json({ error: 'kind must be earning or deduction' }, { status: 400 });
  if (!RECURRING_CODES.includes(code)) return NextResponse.json({ error: 'invalid code' }, { status: 400 });
  if (!label) return NextResponse.json({ error: 'label is required' }, { status: 400 });
  if (!Number.isInteger(amount) || amount <= 0) {
    return NextResponse.json({ error: 'amount_satang must be a positive integer' }, { status: 400 });
  }
  const periods = parsePeriodInput(body);
  if (!periods.ok) return NextResponse.json({ error: periods.error }, { status: 400 });

  const service = createServiceClient();
  const { data: emp, error: empErr } = await service.from('hr_employees').select('id').eq('id', id).maybeSingle();
  if (empErr) return NextResponse.json({ error: 'Failed to verify employee' }, { status: 500 });
  if (!emp) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });

  const { data, error } = await service
    .from(TABLE)
    .insert({
      employee_id: id, kind, code, label, amount_satang: amount, note, created_by: auth.userId,
      start_period: periods.start_period, end_period: periods.end_period,
    })
    .select(COLS)
    .single();
  if (error) return NextResponse.json({ error: 'Failed to add recurring item' }, { status: 500 });

  await logHrAudit(service, {
    actorId: auth.userId, action: 'create', table: TABLE, recordId: data.id as string,
    before: null, after: data, reason: 'recurring payroll item added',
  });
  return NextResponse.json({ data }, { status: 201 });
}

// PATCH /api/hr/employees/[id]/recurring?item_id= — edit an item in place (amount, label, note,
// period window, active). Closes the old delete-and-re-add gap. Audited old→new. Changes affect
// the NEXT generate/recompute only — persisted payslip lines are never touched here.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireHrManagerForEmployeeId(id);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const itemId = request.nextUrl.searchParams.get('item_id') ?? '';
  if (!itemId) return NextResponse.json({ error: 'item_id is required' }, { status: 400 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};

  if (body.amount_satang !== undefined) {
    const amount = Number(body.amount_satang);
    if (!Number.isInteger(amount) || amount <= 0) {
      return NextResponse.json({ error: 'amount_satang must be a positive integer' }, { status: 400 });
    }
    patch.amount_satang = amount;
  }
  if (body.label !== undefined) {
    const label = typeof body.label === 'string' ? body.label.trim() : '';
    if (!label) return NextResponse.json({ error: 'label cannot be empty' }, { status: 400 });
    patch.label = label;
  }
  if (body.note !== undefined) {
    patch.note = typeof body.note === 'string' ? body.note.slice(0, 300) : null;
  }
  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') return NextResponse.json({ error: 'active must be boolean' }, { status: 400 });
    patch.active = body.active;
  }
  if (body.start_period !== undefined || body.end_period !== undefined) {
    const periods = parsePeriodInput(body);
    if (!periods.ok) return NextResponse.json({ error: periods.error }, { status: 400 });
    if (body.start_period !== undefined) patch.start_period = periods.start_period;
    if (body.end_period !== undefined) patch.end_period = periods.end_period;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
  }

  const service = createServiceClient();
  const { data: before } = await service.from(TABLE).select(COLS).eq('id', itemId).eq('employee_id', id).maybeSingle();
  if (!before) return NextResponse.json({ error: 'Item not found' }, { status: 404 });

  // Cross-field window sanity when only one side changes (DB CHECK also guards this).
  const nextStart = (patch.start_period !== undefined ? patch.start_period : before.start_period) as string | null;
  const nextEnd = (patch.end_period !== undefined ? patch.end_period : before.end_period) as string | null;
  if (nextStart && nextEnd && nextEnd < nextStart) {
    return NextResponse.json({ error: 'end_period must not be before start_period' }, { status: 400 });
  }

  const { data, error } = await service
    .from(TABLE)
    .update(patch)
    .eq('id', itemId)
    .eq('employee_id', id)
    .select(COLS)
    .single();
  if (error) return NextResponse.json({ error: 'Failed to update recurring item' }, { status: 500 });

  await logHrAudit(service, {
    actorId: auth.userId, action: 'update', table: TABLE, recordId: itemId,
    before, after: data, reason: 'recurring payroll item updated',
  });
  return NextResponse.json({ data });
}

// DELETE /api/hr/employees/[id]/recurring?item_id= — remove a recurring item. Audited.
// Prefer PATCH end_period for normal lifecycle (keeps history); DELETE is for mistakes.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireHrManagerForEmployeeId(id);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const itemId = request.nextUrl.searchParams.get('item_id') ?? '';
  if (!itemId) return NextResponse.json({ error: 'item_id is required' }, { status: 400 });

  const service = createServiceClient();
  const { data: before } = await service.from(TABLE).select(COLS).eq('id', itemId).eq('employee_id', id).maybeSingle();
  if (!before) return NextResponse.json({ error: 'Item not found' }, { status: 404 });

  const { error } = await service.from(TABLE).delete().eq('id', itemId).eq('employee_id', id);
  if (error) return NextResponse.json({ error: 'Failed to remove item' }, { status: 500 });

  await logHrAudit(service, {
    actorId: auth.userId, action: 'delete', table: TABLE, recordId: itemId,
    before, after: null, reason: 'recurring payroll item removed',
  });
  return NextResponse.json({ data: { id: itemId, removed: true } });
}
