import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { loadReviewLink } from '@/lib/hr/review-link';
import { applyTaxOverride } from '@/lib/hr/tax-override';
import { notifyHrManagers } from '@/lib/hr/notify';

const MAX_ENTRIES = 200;

// PUT /api/hr/payrun-review/[token]/taxes { entries: [{ payslip_id, tax_satang, note? }] }
// PUBLIC (token-gated): the accounting office submits the official tax figures. Each entry is
// verified to belong to the link's payrun; the payrun must still be draft; the shared
// applyTaxOverride helper patches the slips (audited, actor = the HR user who issued the link,
// set_via 'link'). Saving is idempotent and repeatable until expiry/finalize; HR is notified.
export async function PUT(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const service = createServiceClient();

  const loaded = await loadReviewLink(service, token);
  if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  const { link, payrun } = loaded;

  const body0 = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (String(body0.passcode ?? '') !== link.passcode) {
    return NextResponse.json({ error: 'ต้องใส่รหัสให้ถูกต้อง', locked: true }, { status: 401 });
  }

  if (payrun.status !== 'draft') {
    return NextResponse.json({ error: 'งวดนี้ปิดแล้ว — แก้ไขไม่ได้ กรุณาติดต่อ HR' }, { status: 409 });
  }

  const raw = Array.isArray(body0.entries) ? body0.entries : null;
  if (!raw || raw.length === 0) return NextResponse.json({ error: 'entries is required' }, { status: 400 });
  if (raw.length > MAX_ENTRIES) return NextResponse.json({ error: 'Too many entries' }, { status: 400 });

  const entries: { payslip_id: string; tax_satang: number; note: string | null }[] = [];
  for (const e of raw as Record<string, unknown>[]) {
    const payslipId = typeof e.payslip_id === 'string' ? e.payslip_id : '';
    const tax = Number(e.tax_satang);
    if (!payslipId || !Number.isFinite(tax) || tax < 0) {
      return NextResponse.json({ error: 'Each entry needs payslip_id and tax_satang >= 0' }, { status: 400 });
    }
    entries.push({
      payslip_id: payslipId,
      tax_satang: Math.round(tax),
      note: typeof e.note === 'string' && e.note.trim() !== '' ? e.note.trim().slice(0, 300) : null,
    });
  }

  // Every payslip must belong to THIS link's payrun — a token for run A must never touch run B.
  const { data: runSlips, error: slipErr } = await service
    .from('hr_payslips')
    .select('id')
    .eq('payrun_id', payrun.id);
  if (slipErr) return NextResponse.json({ error: 'Failed to load payrun slips' }, { status: 500 });
  const inRun = new Set((runSlips ?? []).map((s) => s.id as string));
  if (entries.some((e) => !inRun.has(e.payslip_id))) {
    return NextResponse.json({ error: 'payslip not in this payrun' }, { status: 400 });
  }

  const results: { payslip_id: string; tax_satang: number; net_satang: number }[] = [];
  for (const e of entries) {
    const applied = await applyTaxOverride(service, {
      payslipId: e.payslip_id,
      taxSatang: e.tax_satang,
      note: e.note,
      setVia: 'link',
      actorId: link.created_by, // audit actor = the HR user who issued the link
      setBy: null,
    });
    if (!applied.ok) return NextResponse.json({ error: applied.error }, { status: applied.status });
    results.push({ payslip_id: applied.payslip.id, tax_satang: applied.payslip.tax_satang, net_satang: applied.payslip.net_satang });
  }

  await service.from('hr_payrun_review_links').update({ saved_at: new Date().toISOString() }).eq('id', link.id);

  try {
    const period = `${String(payrun.period_month).padStart(2, '0')}/${payrun.period_year}`;
    await notifyHrManagers(service, {
      storeId: payrun.store_id ?? null,
      type: 'hr_tax_submitted',
      title: 'สำนักงานบัญชีบันทึกภาษีแล้ว',
      body: `งวด ${period} ${payrun.company?.name ?? ''} — บันทึกภาษี ${results.length} รายการ ตรวจสอบและปิดงวดได้`,
      data: { payrun_id: payrun.id, url: '/hr/payroll' },
    });
  } catch (e) {
    console.error('[payrun-review/taxes] notify failed:', e);
  }

  return NextResponse.json({ data: { saved: results.length, results } });
}
