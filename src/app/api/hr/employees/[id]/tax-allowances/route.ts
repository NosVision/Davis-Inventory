import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';

const TABLE = 'hr_tax_allowances';
const COLS = 'id, employee_id, tax_year, kind, label, amount_satang, active, note';

// ล.ย.01 personal tax allowances (ลดหย่อนภาษี) per employee. HR only — sensitive personal data
// (§B) that feeds the progressive PND1 withholding. [id] = hr_employees.id. Amounts are ANNUAL
// satang (ล.ย.01 is filed per tax year).
const KINDS = [
  'spouse', 'child', 'parent', 'disabled_dependant',
  'life_insurance', 'health_insurance', 'parent_health_insurance',
  'provident_fund', 'rmf', 'ssf', 'home_loan_interest',
  'social_enterprise', 'donation', 'other',
];
const MAX_ALLOWANCE_SATANG = 100_000_000; // ฿1,000,000/line sanity cap

function currentTaxYear(): number {
  // Gregorian year. The engine keys allowances by the payrun cycle's Gregorian year.
  return new Date().getUTCFullYear();
}

// GET /api/hr/employees/[id]/tax-allowances?tax_year= — list (defaults to current year).
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  const yearParam = request.nextUrl.searchParams.get('tax_year');
  const service = createServiceClient();

  let q = service.from(TABLE).select(COLS).eq('employee_id', id);
  if (yearParam) {
    const y = Number(yearParam);
    if (!Number.isInteger(y)) return NextResponse.json({ error: 'tax_year must be an integer' }, { status: 400 });
    q = q.eq('tax_year', y);
  }
  const { data, error } = await q.order('tax_year', { ascending: false }).order('kind');
  if (error) return NextResponse.json({ error: 'Failed to load tax allowances' }, { status: 500 });
  return NextResponse.json({ data: data ?? [] });
}

// POST /api/hr/employees/[id]/tax-allowances — add an allowance line. Audited.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const kind = typeof body.kind === 'string' ? body.kind : '';
  const label = typeof body.label === 'string' ? body.label.trim().slice(0, 200) || null : null;
  const note = typeof body.note === 'string' ? body.note.slice(0, 300) : null;
  const amount = Number(body.amount_satang);
  const taxYear = body.tax_year === undefined ? currentTaxYear() : Number(body.tax_year);

  if (!KINDS.includes(kind)) return NextResponse.json({ error: 'invalid kind' }, { status: 400 });
  if (!Number.isInteger(taxYear) || taxYear < 2000 || taxYear > 2200) {
    return NextResponse.json({ error: 'tax_year must be a valid Gregorian year' }, { status: 400 });
  }
  if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_ALLOWANCE_SATANG) {
    return NextResponse.json({ error: 'amount_satang must be a positive integer up to ฿1,000,000' }, { status: 400 });
  }

  const service = createServiceClient();
  const { data: emp, error: empErr } = await service.from('hr_employees').select('id').eq('id', id).maybeSingle();
  if (empErr) return NextResponse.json({ error: 'Failed to verify employee' }, { status: 500 });
  if (!emp) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });

  const { data, error } = await service
    .from(TABLE)
    .insert({ employee_id: id, tax_year: taxYear, kind, label, amount_satang: amount, note, created_by: auth.userId })
    .select(COLS)
    .single();
  if (error) return NextResponse.json({ error: 'Failed to add tax allowance' }, { status: 500 });

  await logHrAudit(service, {
    actorId: auth.userId, action: 'create', table: TABLE, recordId: data.id as string,
    before: null, after: data, reason: 'ล.ย.01 tax allowance added',
  });
  return NextResponse.json({ data }, { status: 201 });
}

// PATCH /api/hr/employees/[id]/tax-allowances — toggle active or edit amount. Audited.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const itemId = typeof body.item_id === 'string' ? body.item_id : '';
  if (!itemId) return NextResponse.json({ error: 'item_id is required' }, { status: 400 });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.active === 'boolean') patch.active = body.active;
  if (body.amount_satang !== undefined) {
    const amount = Number(body.amount_satang);
    if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_ALLOWANCE_SATANG) {
      return NextResponse.json({ error: 'amount_satang must be a positive integer up to ฿1,000,000' }, { status: 400 });
    }
    patch.amount_satang = amount;
  }
  if (Object.keys(patch).length === 1) {
    return NextResponse.json({ error: 'nothing to update (active or amount_satang required)' }, { status: 400 });
  }

  const service = createServiceClient();
  const { data: before } = await service.from(TABLE).select(COLS).eq('id', itemId).eq('employee_id', id).maybeSingle();
  if (!before) return NextResponse.json({ error: 'Item not found' }, { status: 404 });

  const { data, error } = await service
    .from(TABLE)
    .update(patch)
    .eq('id', itemId)
    .eq('employee_id', id)
    .select(COLS)
    .single();
  if (error) return NextResponse.json({ error: 'Failed to update tax allowance' }, { status: 500 });

  await logHrAudit(service, {
    actorId: auth.userId, action: 'update', table: TABLE, recordId: itemId,
    before, after: data, reason: 'ล.ย.01 tax allowance updated',
  });
  return NextResponse.json({ data });
}

// DELETE /api/hr/employees/[id]/tax-allowances?item_id= — remove a line. Audited.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  const itemId = request.nextUrl.searchParams.get('item_id') ?? '';
  if (!itemId) return NextResponse.json({ error: 'item_id is required' }, { status: 400 });

  const service = createServiceClient();
  const { data: before } = await service.from(TABLE).select(COLS).eq('id', itemId).eq('employee_id', id).maybeSingle();
  if (!before) return NextResponse.json({ error: 'Item not found' }, { status: 404 });

  const { error } = await service.from(TABLE).delete().eq('id', itemId).eq('employee_id', id);
  if (error) return NextResponse.json({ error: 'Failed to remove tax allowance' }, { status: 500 });

  await logHrAudit(service, {
    actorId: auth.userId, action: 'delete', table: TABLE, recordId: itemId,
    before, after: null, reason: 'ล.ย.01 tax allowance removed',
  });
  return NextResponse.json({ data: { id: itemId, removed: true } });
}
