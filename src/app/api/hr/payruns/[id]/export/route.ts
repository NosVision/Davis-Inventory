import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManagerForStore } from '@/lib/hr/route-auth';
import { buildPayrunReviewRows } from '@/lib/hr/review-link';
import { THAI_BANK_OPTIONS, isCashBank, normalizeAccountNo } from '@/lib/hr/bank-transfer';
import { buildXlsx } from '@/lib/xlsx';

const b = (satang: number) => Math.round(satang) / 100;

const bankThByCode = new Map(THAI_BANK_OPTIONS.map((x) => [x.code as string, x.nameTh]));

// GET /api/hr/payruns/[id]/export — the HR-side full "Payment" register as .xlsx. Two withholding
// columns: SS 5% = real social security, and WHT 3% = the foreigner withholding-tax group (stored
// under tax_mode='withholding_3pct'; the legacy sheet mislabelled it "SS 3%" but it is NOT social
// security), plus POSITION / DAYS / SERVICE / REMARK. HR-gated (unlike the token-gated portal export).
//
// Accountant ask 2026-07-27: this register is the working sheet she maps into the BBL bulk-payment
// template, so it now carries BANK + ACCOUNT NO and is ordered exactly like the transfer batches:
//   1) ธนาคารกรุงเทพล้วน (BBL)  2) ต่างธนาคาร (grouped by bank)  3) เงินสด (no account / bank set
//   to cash) — each block ends with its own รายการ/NET subtotal.
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
      ? service
          .from('hr_employees')
          .select('profile_id, bank_name, bank_account_no, position:hr_positions(name)')
          .in('profile_id', userIds)
      : Promise.resolve({ data: [] as unknown[], error: null }),
    service.from('hr_payrun_remarks').select('profile_id, remark').eq('payrun_id', id),
  ]);
  const positionByUser = new Map<string, string>();
  const bankByUser = new Map<string, { bank: string | null; account: string }>();
  for (const e of ((empRes.data ?? []) as unknown as {
    profile_id: string;
    bank_name: string | null;
    bank_account_no: string | null;
    position: { name: string | null } | null;
  }[])) {
    if (e.position?.name) positionByUser.set(e.profile_id, e.position.name);
    bankByUser.set(e.profile_id, {
      bank: e.bank_name?.trim() || null,
      account: normalizeAccountNo(e.bank_account_no),
    });
  }

  // Payment-group classification — same rule as the bank-file batches: no account or a
  // cash-marker bank value ('cash'/'เงินสด'/'-') → เงินสด; BBL first; every other bank after.
  const groupOf = (userId: string): 0 | 1 | 2 => {
    const bk = bankByUser.get(userId);
    if (!bk || !bk.account || isCashBank(bk.bank)) return 2;
    return bk.bank === 'BBL' ? 0 : 1;
  };
  const bankLabelOf = (userId: string): string => {
    const bk = bankByUser.get(userId);
    if (!bk || !bk.account || isCashBank(bk.bank)) return 'เงินสด (CASH)';
    const th = bk.bank ? bankThByCode.get(bk.bank) : undefined;
    return th ? `${th} (${bk.bank})` : bk.bank ?? '';
  };
  const remarkByUser = new Map<string, string>(
    ((remarkRes.data ?? []) as { profile_id: string; remark: string }[]).map((r) => [r.profile_id, r.remark])
  );

  // SS5 (social security) vs WHT3 (foreigner 3% withholding) split by tax_mode: the 3% group's
  // amount lives in tax_satang.
  const ss3 = (r: (typeof rows)[number]) => (r.tax_mode === 'withholding_3pct' ? r.tax_satang : 0);
  const pnd = (r: (typeof rows)[number]) => (r.tax_mode === 'withholding_3pct' ? 0 : r.tax_satang);

  // Order like the transfer batches: BBL → other banks (grouped by bank code) → cash;
  // stable by name inside each bank.
  const sorted = [...rows].sort((a, c) => {
    const g = groupOf(a.user_id) - groupOf(c.user_id);
    if (g !== 0) return g;
    const ba = bankByUser.get(a.user_id)?.bank ?? '';
    const bc = bankByUser.get(c.user_id)?.bank ?? '';
    if (ba !== bc) return ba.localeCompare(bc);
    return a.name.localeCompare(c.name, 'th');
  });

  const period = `${String(payrun.period_month).padStart(2, '0')}/${payrun.period_year}`;
  const company = payrun.company as unknown as { name: string | null } | null;
  const grid: (string | number | null)[][] = [
    [company?.name ?? ''],
    [`งวด ${period} · รอบ ${payrun.cycle_start ?? ''} – ${payrun.cycle_end ?? ''} · จ่าย ${payrun.pay_date ?? ''}`],
    [],
    ['NO.', 'CODE', 'NAME', 'POSITION', 'BANK', 'ACCOUNT NO', 'DAYS', 'SALARY', 'OT', 'ALLOWANCES', 'TOTAL', 'YTD BEFORE',
     'OTHER DEDUCTIONS', 'SS 5%', 'WHT 3%', 'TAX', 'NET', 'SERVICE', 'REMARK'],
  ];

  const GROUP_LABELS: Record<0 | 1 | 2, string> = {
    0: 'รวม ธนาคารกรุงเทพล้วน (BBL)',
    1: 'รวม ต่างธนาคาร',
    2: 'รวม เงินสด (ไม่มีบัญชี)',
  };
  let no = 0;
  for (const g of [0, 1, 2] as const) {
    const block = sorted.filter((r) => groupOf(r.user_id) === g);
    if (block.length === 0) continue;
    for (const r of block) {
      no += 1;
      grid.push([
        no,
        r.employee_code ?? '',
        r.name,
        positionByUser.get(r.user_id) ?? '',
        bankLabelOf(r.user_id),
        bankByUser.get(r.user_id)?.account || '',
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
      ]);
    }
    // Per-batch subtotal — the numbers she reconciles against each bank upload.
    grid.push([
      '', '', GROUP_LABELS[g], `${block.length} รายการ`, '', '', null,
      null, null, null, null, null, null, null, null, null,
      b(block.reduce((s, r) => s + r.net_satang, 0)),
      b(block.reduce((s, r) => s + r.sc_satang, 0)),
      '',
    ]);
  }

  grid.push([]);
  grid.push([
    '', '', 'TOTAL', '', '', '', null,
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
  ]);

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
