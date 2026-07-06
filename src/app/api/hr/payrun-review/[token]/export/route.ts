import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { loadReviewLink, buildPayrunReviewRows } from '@/lib/hr/review-link';
import { buildXlsx } from '@/lib/xlsx';

const b = (satang: number) => Math.round(satang) / 100;

// GET /api/hr/payrun-review/[token]/export — the same summary as the review page, as a real
// .xlsx (the accounting office's familiar Payment-file shape) for their own records. PUBLIC,
// token-gated like the rest of the review family.
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const service = createServiceClient();

  const loaded = await loadReviewLink(service, token);
  if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  const { link, payrun } = loaded;

  const passcode = request.nextUrl.searchParams.get('passcode') ?? '';
  if (passcode !== link.passcode) {
    return NextResponse.json({ error: 'ต้องใส่รหัสให้ถูกต้อง' }, { status: 401 });
  }

  const rows = await buildPayrunReviewRows(service, payrun.id);
  if (rows === null) return NextResponse.json({ error: 'Failed to load payrun' }, { status: 500 });

  const period = `${String(payrun.period_month).padStart(2, '0')}/${payrun.period_year}`;
  const grid: (string | number | null)[][] = [
    [payrun.company?.name ?? ''],
    [`งวด ${period} · รอบ ${payrun.cycle_start ?? ''} – ${payrun.cycle_end ?? ''} · จ่าย ${payrun.pay_date ?? ''}`],
    [],
    ['NO.', 'CODE', 'NAME', 'SALARY', 'OT', 'ALLOWANCES', 'SERVICE CHARGE', 'TOTAL', 'YTD BEFORE', 'DEDUCTIONS', 'SS', 'TAX', 'NET'],
    ...rows.map((r, i) => [
      i + 1,
      r.employee_code ?? '',
      r.name,
      b(r.salary_satang),
      b(r.ot_satang),
      b(r.allowance_satang),
      b(r.sc_satang),
      b(r.gross_satang),
      b(r.ytd_gross_satang),
      b(r.deduction_satang),
      b(r.sso_satang),
      b(r.tax_satang),
      b(r.net_satang),
    ]),
    [],
    [
      '', '', 'TOTAL',
      b(rows.reduce((s, r) => s + r.salary_satang, 0)),
      b(rows.reduce((s, r) => s + r.ot_satang, 0)),
      b(rows.reduce((s, r) => s + r.allowance_satang, 0)),
      b(rows.reduce((s, r) => s + r.sc_satang, 0)),
      b(rows.reduce((s, r) => s + r.gross_satang, 0)),
      null,
      b(rows.reduce((s, r) => s + r.deduction_satang, 0)),
      b(rows.reduce((s, r) => s + r.sso_satang, 0)),
      b(rows.reduce((s, r) => s + r.tax_satang, 0)),
      b(rows.reduce((s, r) => s + r.net_satang, 0)),
    ],
  ];

  const buf = await buildXlsx([{ name: 'Payment', rows: grid }]);
  const fname = `payment-${payrun.period_year}-${String(payrun.period_month).padStart(2, '0')}.xlsx`;
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fname}"`,
      'Cache-Control': 'no-store',
    },
  });
}
