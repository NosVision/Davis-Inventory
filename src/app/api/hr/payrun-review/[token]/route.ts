import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { loadReviewLink, buildPayrunReviewRows } from '@/lib/hr/review-link';

// GET /api/hr/payrun-review/[token] — PUBLIC (middleware-whitelisted): the token IS the
// credential. Returns the payrun summary the accounting office needs to compute taxes —
// intentionally the same information the old Payment file carried, name-level PII included,
// bounded by the hashed-token check + expiry + revocation.
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const service = createServiceClient();

  const loaded = await loadReviewLink(service, token);
  if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  const { link, payrun } = loaded;

  // passcode gate (second factor). Missing/wrong → 401 { locked } so the page shows the prompt.
  const passcode = request.nextUrl.searchParams.get('passcode') ?? '';
  if (passcode !== link.passcode) {
    return NextResponse.json({ error: 'ต้องใส่รหัสให้ถูกต้อง', locked: true }, { status: 401 });
  }

  if (!link.accessed_at) {
    await service.from('hr_payrun_review_links').update({ accessed_at: new Date().toISOString() }).eq('id', link.id);
  }

  const rows = await buildPayrunReviewRows(service, payrun.id);
  if (rows === null) return NextResponse.json({ error: 'Failed to load payrun' }, { status: 500 });

  return NextResponse.json({
    data: {
      payrun: {
        id: payrun.id,
        status: payrun.status,
        period_year: payrun.period_year,
        period_month: payrun.period_month,
        cycle_start: payrun.cycle_start,
        cycle_end: payrun.cycle_end,
        pay_date: payrun.pay_date,
        company: payrun.company,
      },
      link: { expires_at: link.expires_at, saved_at: link.saved_at },
      rows,
    },
  });
}
