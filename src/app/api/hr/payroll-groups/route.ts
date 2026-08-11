import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';

/**
 * Payroll groups — slices of one company's payroll that are run separately, so two HR users can
 * each own part of it without their people mixing (owner ask 2026-08-11).
 *
 * A separate axis from hr_employees.pay_confidential: the group decides WHICH RUN someone is in,
 * the flag decides WHO MAY SEE their figures. They cover the same ten people today and need not
 * tomorrow.
 *
 * Employees with no group are the default slice — a payrun with payroll_group_id IS NULL — so
 * nobody has to be assigned for payroll to keep working exactly as it does now.
 */
const TABLE = 'hr_payroll_groups';

// GET /api/hr/payroll-groups?company_id= — groups plus how many employees sit in each, and how
// many of those carry confidential pay (which decides who may open the group's payrun).
export async function GET(request: NextRequest) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const companyId = request.nextUrl.searchParams.get('company_id');
  const service = createServiceClient();

  let q = service.from(TABLE).select('id, company_id, name, note, sort_order, created_at');
  if (companyId) q = q.eq('company_id', companyId);
  const { data: groups, error } = await q.order('sort_order').order('name');
  if (error) return NextResponse.json({ error: 'Failed to load payroll groups' }, { status: 500 });

  let empQ = service
    .from('hr_employees')
    .select('payroll_group_id, company_id, pay_confidential')
    .in('status', ['active', 'probation']);
  if (companyId) empQ = empQ.eq('company_id', companyId);
  const { data: emps } = await empQ;

  const counts = new Map<string, { total: number; confidential: number }>();
  for (const e of (emps ?? []) as { payroll_group_id: string | null; pay_confidential: boolean }[]) {
    // null → the default slice, keyed as '' so it can be reported alongside the named ones.
    const key = e.payroll_group_id ?? '';
    const cur = counts.get(key) ?? { total: 0, confidential: 0 };
    cur.total += 1;
    if (e.pay_confidential) cur.confidential += 1;
    counts.set(key, cur);
  }

  return NextResponse.json({
    data: {
      groups: (groups ?? []).map((g) => ({
        ...g,
        employee_count: counts.get(g.id as string)?.total ?? 0,
        confidential_count: counts.get(g.id as string)?.confidential ?? 0,
      })),
      ungrouped: counts.get('') ?? { total: 0, confidential: 0 },
    },
  });
}

// POST /api/hr/payroll-groups { company_id, name, note? }
export async function POST(request: NextRequest) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const companyId = typeof body.company_id === 'string' ? body.company_id : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const note = typeof body.note === 'string' ? body.note.trim() || null : null;
  if (!companyId || !name) {
    return NextResponse.json({ error: 'company_id and name are required' }, { status: 400 });
  }

  const service = createServiceClient();
  const { data, error } = await service
    .from(TABLE)
    .insert({ company_id: companyId, name, note, created_by: auth.userId })
    .select('id, name')
    .single();
  if (error) {
    if ((error as { code?: string }).code === '23505') {
      return NextResponse.json({ error: 'มีกลุ่มชื่อนี้ในบริษัทนี้อยู่แล้ว' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'create',
    table: TABLE,
    recordId: data.id as string,
    before: null,
    after: data as Record<string, unknown>,
    reason: `Payroll group created: ${name}`,
  });
  return NextResponse.json({ data }, { status: 201 });
}

// DELETE /api/hr/payroll-groups?id= — refused while any payrun still references the group, so a
// run can never be orphaned from the population it was built for.
export async function DELETE(request: NextRequest) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const id = request.nextUrl.searchParams.get('id') ?? '';
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const service = createServiceClient();
  const { count } = await service
    .from('hr_payruns')
    .select('id', { count: 'exact', head: true })
    .eq('payroll_group_id', id);
  if ((count ?? 0) > 0) {
    return NextResponse.json(
      { error: `ลบไม่ได้ — มีงวดเงินเดือน ${count} งวดที่ใช้กลุ่มนี้อยู่` },
      { status: 409 }
    );
  }

  const { data: before } = await service.from(TABLE).select('*').eq('id', id).maybeSingle();
  if (!before) return NextResponse.json({ error: 'ไม่พบกลุ่มนี้' }, { status: 404 });

  // Members fall back to the default slice (FK is ON DELETE SET NULL) rather than vanishing.
  const { error } = await service.from(TABLE).delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'delete',
    table: TABLE,
    recordId: id,
    before: before as Record<string, unknown>,
    after: null,
    reason: 'Payroll group deleted — members returned to the ungrouped slice',
  });
  return NextResponse.json({ success: true });
}
