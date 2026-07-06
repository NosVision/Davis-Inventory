'use client';

import type { PayslipDetailData, PayslipLine } from '@/components/hr/payslip-view';

// FIXED-POSITION slip form for the 9×5.5" continuous security paper on the Epson LQ-310
// (photos 2026-07-06): the form's dark security zone hides the money area, so every field must
// land at the same physical position on every slip — ALL rows always print (0.00 when empty),
// text-only (no fills — dot matrix), thin table borders like the accountant's Excel form.
// Layout mirrors that workbook verbatim: header meta grid, 13 earning rows (their 12 + อื่นๆ),
// 12 deduction rows, Total / Total deduction / Net Pay / Signature boxes on the right.

const F = (satang: number) => (satang / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Slot { label: string; count?: string; amount: number }

function numFromRef(ref: string | null | undefined): string {
  if (!ref) return '';
  const m = String(ref).match(/[\d.]+/);
  return m ? m[0] : '';
}

/** map itemized lines → the form's fixed slots (unmatched fall into อื่นๆ / Other) */
export function mapSlipToFormSlots(data: PayslipDetailData): { earn: Slot[]; ded: Slot[] } {
  const { payslip, earnings, deductions } = data;
  const eSum = (pred: (l: PayslipLine) => boolean) => earnings.filter(pred).reduce((s, l) => s + l.amount_satang, 0);
  const dPick = (pred: (l: PayslipLine) => boolean) => deductions.filter(pred);
  const dSum = (pred: (l: PayslipLine) => boolean) => dPick(pred).reduce((s, l) => s + l.amount_satang, 0);
  const labelHas = (l: PayslipLine, kw: string[]) => kw.some((k) => (l.label || '').includes(k));

  const isCol = (l: PayslipLine) => l.type !== 'salary' && l.type !== 'ot' && labelHas(l, ['ครองชีพ', 'Cost of living']);
  const isHouse = (l: PayslipLine) => labelHas(l, ['บ้าน', 'House', 'ที่พัก']);
  const isTel = (l: PayslipLine) => labelHas(l, ['โทร', 'Telephone', 'Phone']);
  const isTrans = (l: PayslipLine) => labelHas(l, ['เดินทาง', 'Transport', 'รถ']);
  const isHol = (l: PayslipLine) => labelHas(l, ['ชดเชย', 'holiday', 'Holiday']);
  const isScTip = (l: PayslipLine) => l.type === 'service_charge' || l.type === 'tip';
  const matchedEarn = (l: PayslipLine) =>
    l.type === 'salary' || l.type === 'ot' || isScTip(l) || isCol(l) || isHouse(l) || isTel(l) || isTrans(l) || isHol(l);

  const otLine = earnings.find((l) => l.type === 'ot');
  const earn: Slot[] = [
    { label: 'Rate', amount: payslip.rate_satang ?? 0 },
    { label: 'Salary', count: payslip.worked_days != null ? String(payslip.worked_days) : '', amount: eSum((l) => l.type === 'salary') },
    { label: 'Overtime 1', amount: 0 },
    { label: 'Overtime 1.5', count: numFromRef(otLine?.ref), amount: eSum((l) => l.type === 'ot') },
    { label: 'Overtime 2', amount: 0 },
    { label: 'Other overtime', amount: 0 },
    { label: 'Cost of living', amount: eSum(isCol) },
    { label: 'House rent', amount: eSum(isHouse) },
    { label: 'Telephone', amount: eSum(isTel) },
    { label: 'Transportation allowance', amount: eSum(isTrans) },
    { label: 'holiday compensation', amount: eSum(isHol) },
    { label: 'Service charge', amount: eSum(isScTip) },
    { label: 'อื่นๆ / Other', amount: eSum((l) => !matchedEarn(l)) },
  ];

  const isSick = (l: PayslipLine) => l.type === 'leave_unpaid' && labelHas(l, ['SLW', 'ป่วย', 'sick', 'SICK']);
  const isLwop = (l: PayslipLine) => l.type === 'leave_unpaid' && !isSick(l);
  const taxIs3pct = payslip.tax_mode === 'withholding_3pct';
  const matchedDed = (l: PayslipLine) =>
    ['late', 'absent', 'leave_unpaid', 'student_loan', 'advance', 'guarantee', 'loan', 'sso', 'tax'].includes(l.type);

  const lateLines = dPick((l) => l.type === 'late');
  const absentLines = dPick((l) => l.type === 'absent');
  const ded: Slot[] = [
    { label: 'Lateness Deduction (Day)', count: numFromRef(lateLines[0]?.ref), amount: dSum((l) => l.type === 'late') },
    { label: 'Absence  Deduction', count: numFromRef(absentLines[0]?.ref), amount: dSum((l) => l.type === 'absent') },
    { label: 'Sick leave Deduction', amount: dSum(isSick) },
    { label: 'Leave without pay', amount: dSum(isLwop) },
    { label: 'Student Loan Fund (กยศ)', amount: dSum((l) => l.type === 'student_loan') },
    { label: 'Advance Deduction', amount: dSum((l) => l.type === 'advance') },
    { label: 'Initial Insurance Deduction', amount: dSum((l) => l.type === 'guarantee') },
    { label: 'Loan repayment', amount: dSum((l) => l.type === 'loan') },
    { label: 'Withholding Tax', amount: taxIs3pct ? dSum((l) => l.type === 'tax') : 0 },
    { label: 'Social Security Contribution', amount: dSum((l) => l.type === 'sso') },
    { label: 'Tax Deduction', amount: taxIs3pct ? 0 : dSum((l) => l.type === 'tax') },
    { label: 'Other Deduction', amount: dSum((l) => !matchedDed(l)) },
  ];

  return { earn, ded };
}

const CELL = 'border border-gray-500 px-1 leading-[13px]';

export function PayslipFormPrint({ data, calibrate = false }: { data: PayslipDetailData; calibrate?: boolean }) {
  const { payslip, payrun } = data;
  const { earn, ded } = mapSlipToFormSlots(data);
  const monthLabel = payrun
    ? `${new Date(Date.UTC(payrun.period_year, payrun.period_month - 1, 1)).toLocaleString('en-US', { month: 'long' })} ${payrun.period_year}`
    : '—';
  const periodLabel = payrun && 'cycle_start' in payrun
    ? `${(payrun as { cycle_start?: string | null }).cycle_start ?? ''} - ${(payrun as { cycle_end?: string | null }).cycle_end ?? ''}`
    : '';
  const V = (s: string | null | undefined) => (calibrate ? 'X'.repeat(6) : s || '');
  const A = (n: number) => (calibrate ? '9,999.99' : F(n));

  const rows = Math.max(earn.length, ded.length);

  return (
    <div className="w-[8.4in] bg-white font-sans text-[10px] leading-[13px] text-black">
      {/* header — lands in the form's VISIBLE zone */}
      <div className="text-center">
        <p className="text-[13px] font-bold leading-4">{payrun?.company?.name ?? ''}</p>
        <p className="leading-3">{payrun?.company?.address ?? ''}</p>
      </div>
      <div className="mt-1 grid grid-cols-[0.9in_1.2in_0.9in_2.2in_1in_1.6in] gap-x-1">
        <span className="text-gray-700">Code</span>
        <span>{V(payslip.employee_code)}</span>
        <span className="text-gray-700">Last Name</span>
        <span className="truncate">{V(payslip.employee_name)}</span>
        <span className="text-gray-700">Month</span>
        <span>{calibrate ? 'Month 9999' : monthLabel}</span>
        <span className="text-gray-700">Account Nur</span>
        <span>{V(payslip.bank_account_no)}</span>
        <span className="text-gray-700">Nickname</span>
        <span className="truncate">{V(payslip.nickname)}</span>
        <span className="text-gray-700">Payroll Period</span>
        <span>{calibrate ? '99/99/99 - 99/99/99' : periodLabel}</span>
      </div>

      {/* body — lands in the HIDDEN (security) zone */}
      <div className="mt-1 flex items-start gap-2">
        <table className="border-collapse" style={{ width: '6.1in' }}>
          <thead>
            <tr className="text-center font-semibold">
              <td className={CELL} style={{ width: '1.9in' }}>Description</td>
              <td className={CELL} style={{ width: '0.5in' }}>Count</td>
              <td className={CELL} style={{ width: '0.8in' }}>Amount</td>
              <td className={CELL} style={{ width: '1.9in' }}>Deduction</td>
              <td className={CELL} style={{ width: '0.5in' }}>Count</td>
              <td className={CELL} style={{ width: '0.8in' }}>Amount</td>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }, (_, i) => (
              <tr key={i}>
                <td className={CELL}>{earn[i]?.label ?? ''}</td>
                <td className={`${CELL} text-right tabular-nums`}>{earn[i] ? (calibrate ? '99' : earn[i].count ?? '') : ''}</td>
                <td className={`${CELL} text-right tabular-nums`}>{earn[i] ? A(earn[i].amount) : ''}</td>
                <td className={CELL}>{ded[i]?.label ?? ''}</td>
                <td className={`${CELL} text-right tabular-nums`}>{ded[i] ? (calibrate ? '99' : ded[i].count ?? '') : ''}</td>
                <td className={`${CELL} text-right tabular-nums`}>{ded[i] ? A(ded[i].amount) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* right boxes */}
        <div className="grid gap-1" style={{ width: '1.9in' }}>
          <div>
            <div className={`${CELL} bg-transparent text-center font-bold`}>Total</div>
            <div className={`${CELL} text-right font-semibold tabular-nums`}>{A(payslip.gross_satang)}</div>
          </div>
          <div>
            <div className={`${CELL} text-center font-bold`}>Total deduction</div>
            <div className={`${CELL} text-right font-semibold tabular-nums`}>{A(payslip.total_deduction_satang)}</div>
          </div>
          <div>
            <div className={`${CELL} text-center font-bold`}>Net Pay</div>
            <div className={`${CELL} text-right font-bold tabular-nums`}>{A(payslip.net_satang)}</div>
          </div>
          <div>
            <div className={`${CELL} text-center font-bold`}>Signature</div>
            <div className={CELL} style={{ height: '0.55in' }} />
          </div>
        </div>
      </div>
    </div>
  );
}
