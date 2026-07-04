import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManagerForEmployeeId } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';

const KINDS = ['earning', 'deduction'];
const TABLE = 'hr_employee_recurring';
const COLS = 'id, employee_id, kind, code, label, amount_satang, active, note';

// Per-employee recurring monthly payroll items (allowances = earnings; fixed deductions).
// HR only — these feed the payroll engine, so they are salary-sensitive. [id] = hr_employees.id.

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
  if (!code || !label) return NextResponse.json({ error: 'code and label are required' }, { status: 400 });
  if (!Number.isInteger(amount) || amount <= 0) {
    return NextResponse.json({ error: 'amount_satang must be a positive integer' }, { status: 400 });
  }

  const service = createServiceClient();
  const { data: emp, error: empErr } = await service.from('hr_employees').select('id').eq('id', id).maybeSingle();
  if (empErr) return NextResponse.json({ error: 'Failed to verify employee' }, { status: 500 });
  if (!emp) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });

  const { data, error } = await service
    .from(TABLE)
    .insert({ employee_id: id, kind, code, label, amount_satang: amount, note, created_by: auth.userId })
    .select(COLS)
    .single();
  if (error) return NextResponse.json({ error: 'Failed to add recurring item' }, { status: 500 });

  await logHrAudit(service, {
    actorId: auth.userId, action: 'create', table: TABLE, recordId: data.id as string,
    before: null, after: data, reason: 'recurring payroll item added',
  });
  return NextResponse.json({ data }, { status: 201 });
}

// DELETE /api/hr/employees/[id]/recurring?item_id= — remove a recurring item. Audited.
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
