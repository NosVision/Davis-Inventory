import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManagerForStore } from '@/lib/hr/route-auth';
import { applyTaxOverride } from '@/lib/hr/tax-override';
import { refusePayrunIfHidden } from '@/lib/hr/payrun-access';

// PUT /api/hr/payslips/[id]/tax-override { tax_satang, note? } — HR FALLBACK path for keying
// the accounting office's official tax figure (the primary path is the accountant review link).
// Draft payruns only; scoped like the payslip detail route; audited inside the helper.
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const service = createServiceClient();

  // Scope: company-wide HR, or a manager scoped to the payrun's store.
  const { data: slip } = await service.from('hr_payslips').select('payrun_id').eq('id', id).maybeSingle();
  if (!slip) return NextResponse.json({ error: 'Payslip not found' }, { status: 404 });
  const { data: pr } = await service.from('hr_payruns').select('store_id').eq('id', slip.payrun_id).maybeSingle();
  const auth = await requireHrManagerForStore((pr?.store_id as string | null | undefined) ?? null);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  // The official tax figure moves this person's net pay — a payrun action like any other, under the
  // same "can you see everyone in the run" rule (payrun-access.ts).
  const refusal = await refusePayrunIfHidden(service, auth.userId, slip.payrun_id as string);
  if (refusal) return NextResponse.json({ error: refusal }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const taxSatang = Number(body.tax_satang);
  if (!Number.isFinite(taxSatang) || taxSatang < 0) {
    return NextResponse.json({ error: 'tax_satang must be a number >= 0' }, { status: 400 });
  }
  const note = typeof body.note === 'string' && body.note.trim() !== '' ? body.note.trim().slice(0, 300) : null;

  const result = await applyTaxOverride(service, {
    payslipId: id,
    taxSatang,
    note,
    setVia: 'hr',
    actorId: auth.userId,
    setBy: auth.userId,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ data: result.payslip });
}
