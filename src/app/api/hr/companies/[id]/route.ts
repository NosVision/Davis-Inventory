import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';

// PUT /api/hr/companies/[id] — edit a legal entity. The MONEY parameters (sso_rate, ceiling,
// day_divisor, OT multiplier) feed computePayslip directly, so changing any of them requires a
// reason (same bar as employee rate/bank edits) and everything is audited before/after.
const MONEY_FIELDS = ['sso_rate', 'sso_wage_ceiling_satang', 'day_divisor', 'ot_multipliers', 'wht_rate', 'sso_prorate'] as const;

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const fields: Record<string, unknown> = {};
  const errors: string[] = [];

  if ('name' in body) {
    const name = String(body.name ?? '').trim();
    if (!name) errors.push('name must not be empty');
    else fields.name = name;
  }
  if ('name_en' in body) fields.name_en = body.name_en === null || body.name_en === '' ? null : String(body.name_en).trim();
  if ('address' in body) fields.address = body.address === null || body.address === '' ? null : String(body.address);
  if ('phone' in body) fields.phone = body.phone === null || body.phone === '' ? null : String(body.phone).trim();
  if ('tax_id' in body) {
    const t = String(body.tax_id ?? '').trim();
    if (t !== '' && !/^\d{13}$/.test(t)) errors.push('tax_id must be 13 digits');
    else fields.tax_id = t === '' ? null : t;
  }
  if ('payslip_paper' in body) fields.payslip_paper = body.payslip_paper === null || body.payslip_paper === '' ? null : String(body.payslip_paper);
  if ('active' in body) fields.active = Boolean(body.active);
  if ('sso_rate' in body) {
    const n = Number(body.sso_rate);
    if (!Number.isFinite(n) || n < 0 || n > 0.1) errors.push('sso_rate must be 0–0.10 (fraction)');
    else fields.sso_rate = n;
  }
  if ('sso_wage_ceiling_satang' in body) {
    const n = Number(body.sso_wage_ceiling_satang);
    if (!Number.isInteger(n) || n < 0 || n > 100_000_000) errors.push('sso_wage_ceiling_satang out of range');
    else fields.sso_wage_ceiling_satang = n;
  }
  if ('day_divisor' in body) {
    const n = Number(body.day_divisor);
    if (!Number.isInteger(n) || n < 1 || n > 31) errors.push('day_divisor must be 1–31');
    else fields.day_divisor = n;
  }
  if ('ot1_multiplier' in body) {
    const n = Number(body.ot1_multiplier);
    if (!Number.isFinite(n) || n < 1 || n > 5) errors.push('ot1_multiplier must be 1–5');
    else fields.ot_multipliers = { ot1: n };
  }
  if ('wht_rate' in body) {
    const n = Number(body.wht_rate);
    if (!Number.isFinite(n) || n < 0 || n > 0.2) errors.push('wht_rate must be 0–0.20 (fraction)');
    else fields.wht_rate = n;
  }
  if ('sso_prorate' in body) fields.sso_prorate = Boolean(body.sso_prorate);
  if (errors.length) return NextResponse.json({ error: errors.join('; ') }, { status: 400 });
  if (Object.keys(fields).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

  const touchesMoney = MONEY_FIELDS.some((k) => k in fields);
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (touchesMoney && !reason) {
    return NextResponse.json({ error: 'Reason is required when changing payroll parameters' }, { status: 400 });
  }

  const service = createServiceClient();
  const { data: before, error: loadErr } = await service.from('hr_companies').select('*').eq('id', id).maybeSingle();
  if (loadErr) return NextResponse.json({ error: 'Failed to load company' }, { status: 500 });
  if (!before) return NextResponse.json({ error: 'Company not found' }, { status: 404 });

  const { data: after, error: updErr } = await service
    .from('hr_companies')
    .update(fields)
    .eq('id', id)
    .select('*')
    .single();
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'update',
    table: 'hr_companies',
    recordId: id,
    before,
    after,
    reason: reason || null,
  });

  return NextResponse.json({ data: after });
}
