import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManagerForStore } from '@/lib/hr/route-auth';
import { buildPayrunReviewRows } from '@/lib/hr/review-link';
import { buildXlsx } from '@/lib/xlsx';

const b = (satang: number) => Math.round(satang) / 100;

// GET /api/hr/payruns/[id]/export — the HR-side full "Payment" register as .xlsx, in the legacy
// file's shape: SS 5% and SS 3% as TWO columns (the system stores the 3% group's money under
// tax_mode='withholding_3pct'; accountants reconciling against the old file expect it in its own
// column), plus POSITION / DAYS / SERVICE / REMARK. HR-gated (unlike the token-gated portal export).
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const service = createServiceClient();

  const { data: payrun, error: prErr } = await service
    .from('hr_payruns')
    .select('id, store_id, period_year, period_month, cycle_start, cycle_end, pay_date, company:hr_companies(name)')
    .eq('id', id)
    .maybeSingle();
  if (prErr) return NextResponse.json({ error: 'Failed to load payrun' }, { status: 500 });
  if (!payrun) return NextResponse.json({ error: 'Payrun not found' }, { status: 404 });
  const auth = await requireHrManagerForStore(payrun.store_id as string | null);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rows = await buildPayrunReviewRows(service, id);
  if (rows === null) return NextResponse.json({ error: 'Failed to load payrun rows' }, { status: 500 });

  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const [empRes, remarkRes] = await Promise.all([
    userIds.length
      ? service.from('hr_employees').select('profile_id, position:hr_positions(name)').in('profile_id', userIds)
      : Promise.resolve({ data: [] as unknown[], error: null }),
    service.from('hr_payrun_remarks').select('profile_id, remark').eq('payrun_id', id),
  ]);
  const positionByUser = new Map<string, string>();
  for (const e of ((empRes.data ?? []) as unknown as { profile_id: string; position: { name: string | null } | null }[])) {
    if (e.position?.name) positionByUser.set(e.profile_id, e.position.name);
  }
  const remarkByUser = new Map<string, string>(
    ((remarkRes.data ?? []) as { profile_id: string; remark: string }[]).map((r) => [r.profile_id, r.remark])
  );

  // SS5 vs SS3 split by tax_mode: the withholding-3% group's amount lives in tax_satang.
  const ss3 = (r: (typeof rows)[number]) => (r.tax_mode === 'withholding_3pct' ? r.tax_satang : 0);
  const pnd = (r: (typeof rows)[number]) => (r.tax_mode === 'withholding_3pct' ? 0 : r.tax_satang);

  const period = `${String(payrun.period_month).padStart(2, '0')}/${payrun.period_year}`;
  const company = payrun.company as unknown as { name: string | null } | null;
  const grid: (string | number | null)[][] = [
    [company?.name ?? ''],
    [`งวด ${period} · รอบ ${payrun.cycle_start ?? ''} – ${payrun.cycle_end ?? ''} · จ่าย ${payrun.pay_date ?? ''}`],
    [],
    ['NO.', 'CODE', 'NAME', 'POSITION', 'DAYS', 'SALARY', 'OT', 'ALLOWANCES', 'TOTAL', 'YTD BEFORE',
     'OTHER DEDUCTIONS', 'SS 5%', 'SS 3%', 'TAX', 'NET', 'SERVICE', 'REMARK'],
    ...rows.map((r, i) => [
      i + 1,
      r.employee_code ?? '',
      r.name,
      positionByUser.get(r.user_id) ?? '',
      r.worked_days,
      b(r.salary_satang),
      b(r.ot_satang),
      b(r.allowance_satang),
      b(r.gross_satang),
      b(r.ytd_gross_satang),
      b(r.deduction_satang),
      b(r.sso_satang),
      b(ss3(r)),
      b(pnd(r)),
      b(r.net_satang),
      b(r.sc_satang),
      remarkByUser.get(r.user_id) ?? '',
    ]),
    [],
    [
      '', '', 'TOTAL', '', null,
      b(rows.reduce((s, r) => s + r.salary_satang, 0)),
      b(rows.reduce((s, r) => s + r.ot_satang, 0)),
      b(rows.reduce((s, r) => s + r.allowance_satang, 0)),
      b(rows.reduce((s, r) => s + r.gross_satang, 0)),
      null,
      b(rows.reduce((s, r) => s + r.deduction_satang, 0)),
      b(rows.reduce((s, r) => s + r.sso_satang, 0)),
      b(rows.reduce((s, r) => s + ss3(r), 0)),
      b(rows.reduce((s, r) => s + pnd(r), 0)),
      b(rows.reduce((s, r) => s + r.net_satang, 0)),
      b(rows.reduce((s, r) => s + r.sc_satang, 0)),
      '',
    ],
  ];

  const buf = await buildXlsx([{ name: 'Payment', rows: grid }]);
  const fname = `payment-full-${payrun.period_year}-${String(payrun.period_month).padStart(2, '0')}.xlsx`;
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fname}"`,
      'Cache-Control': 'no-store',
    },
  });
}
