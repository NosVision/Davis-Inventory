import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { loadReviewLink } from '@/lib/hr/review-link';
import { notifyHrManagers } from '@/lib/hr/notify';

// POST /api/hr/payrun-review/[token]/confirm { passcode } — PUBLIC (token-gated): the
// accounting office declares "ตรวจครบทุกคนแล้ว". Purely a status stamp — no payroll data
// changes — so it works on draft AND finalized runs. Saving taxes again clears it (see
// taxes/route.ts); repeat confirms just refresh the timestamp.
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const service = createServiceClient();

  const loaded = await loadReviewLink(service, token);
  if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  const { link, payrun } = loaded;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (String(body.passcode ?? '') !== link.passcode) {
    return NextResponse.json({ error: 'ต้องใส่รหัสให้ถูกต้อง', locked: true }, { status: 401 });
  }

  const confirmedAt = new Date().toISOString();
  const { error } = await service
    .from('hr_payrun_review_links')
    .update({ confirmed_at: confirmedAt })
    .eq('id', link.id);
  if (error) return NextResponse.json({ error: 'บันทึกไม่สำเร็จ' }, { status: 500 });

  try {
    const period = `${String(payrun.period_month).padStart(2, '0')}/${payrun.period_year}`;
    await notifyHrManagers(service, {
      storeId: payrun.store_id ?? null,
      type: 'hr_review_confirmed',
      title: 'สำนักงานบัญชียืนยันตรวจครบแล้ว',
      body: `งวด ${period} ${payrun.company?.name ?? ''} — ตรวจครบทุกรายการ พร้อมปิดงวด`,
      data: { payrun_id: payrun.id, url: '/hr/payroll' },
    });
  } catch (e) {
    console.error('[payrun-review/confirm] notify failed:', e);
  }

  return NextResponse.json({ data: { confirmed_at: confirmedAt } });
}
