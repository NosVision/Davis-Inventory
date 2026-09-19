import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { loadPayVisibility, redactEmployeePay } from '@/lib/hr/pay-visibility';

// POST /api/hr/employees/[id]/transfer  — move an employee to another company (§A).
// Body: { company_id, effective_date, reason }. reason is REQUIRED (sensitive change, §B).
// v1: transfer is immediate; effective_date + reason are recorded in hr_audit_log.
//
// What moves with the person, and what does not (2026-09-19):
//   • payroll_group_id is CLEARED. Groups belong to a company (00185), so a group from the old
//     company is meaningless at the new one — and worse than meaningless: the old company's runs
//     filter by company, and the new company's default run takes only the ungrouped, so a moved
//     person still carrying the old group dropped out of every payrun. They land in the new
//     company's default run until HR files them into a group there.
//   • work_store_id is KEPT. A venue is not a company: the person still works where they work.
//   • The old company's roster/timesheet stop listing them on their next load, because company
//     scope in lib/hr/roster.ts reads the live company_id; store scope never looked at company.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    company_id?: string;
    effective_date?: string;
    reason?: string;
  };

  if (typeof body.company_id !== 'string' || !body.company_id) {
    return NextResponse.json({ error: 'company_id is required' }, { status: 400 });
  }
  if (typeof body.reason !== 'string' || !body.reason.trim()) {
    return NextResponse.json({ error: 'reason is required for a company transfer' }, { status: 400 });
  }

  const service = createServiceClient();

  const { data: current, error: fetchErr } = await service
    .from('hr_employees')
    .select('id, company_id, payroll_group_id, work_store_id')
    .eq('id', id)
    .single();
  if (fetchErr || !current) {
    return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
  }

  // verify target company exists AND is active
  const { data: company } = await service
    .from('hr_companies')
    .select('id, active')
    .eq('id', body.company_id)
    .maybeSingle();
  if (!company) {
    return NextResponse.json({ error: 'Target company not found' }, { status: 400 });
  }
  if (company.active === false) {
    return NextResponse.json({ error: 'Target company is not active' }, { status: 400 });
  }

  const { data: updated, error: updErr } = await service
    .from('hr_employees')
    .update({ company_id: body.company_id, payroll_group_id: null, updated_by: auth.userId })
    .eq('id', id)
    .select('*')
    .single();
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  const reason = body.reason.trim();
  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'update',
    table: 'hr_employees',
    recordId: id,
    before: { company_id: current.company_id, payroll_group_id: current.payroll_group_id },
    after: {
      company_id: body.company_id,
      payroll_group_id: null,
      work_store_id: current.work_store_id,
      effective_date: body.effective_date ?? null,
    },
    reason,
  });
  // The group clearing gets its own line so the pay-group history reads as a consequence of the
  // transfer, not as an unexplained edit sitting next to HR's stated reason.
  if (current.payroll_group_id) {
    await logHrAudit(service, {
      actorId: auth.userId,
      action: 'update',
      table: 'hr_employees',
      recordId: id,
      before: { payroll_group_id: current.payroll_group_id },
      after: { payroll_group_id: null },
      reason: 'company_transfer',
    });
  }

  // Same redaction as the list/detail reads: the caller gets the row back, minus any pay figures
  // they may not see for this person.
  const [employee] = redactEmployeePay(
    [updated as Record<string, unknown>],
    await loadPayVisibility(service, auth.userId)
  );
  return NextResponse.json({ success: true, employee });
}
