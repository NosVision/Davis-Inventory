import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';

// POST /api/hr/employees/[id]/transfer  — move an employee to another company (§A).
// Body: { company_id, effective_date, reason }. reason is REQUIRED (sensitive change, §B).
// v1: transfer is immediate; effective_date + reason are recorded in hr_audit_log.
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
    .select('id, company_id')
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
    .update({ company_id: body.company_id, updated_by: auth.userId })
    .eq('id', id)
    .select('id, company_id')
    .single();
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'update',
    table: 'hr_employees',
    recordId: id,
    before: { company_id: current.company_id },
    after: { company_id: body.company_id, effective_date: body.effective_date ?? null },
    reason: body.reason.trim(),
  });

  return NextResponse.json({ success: true, employee: updated });
}
