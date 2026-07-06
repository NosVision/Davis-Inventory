'use client';

import { useTranslations } from 'next-intl';
import { formatBaht } from '@/lib/pos/money';

export interface PayslipLine {
  type: string;
  label: string;
  amount_satang: number;
  ref?: string | null;
  reason?: string | null;
}
export interface PayslipDetailData {
  payslip: {
    id: string;
    employee_name?: string;
    employee_code?: string | null;
    nickname?: string | null;
    bank_account_no?: string | null;
    rate_satang?: number;
    pay_type: string;
    tax_mode?: string;
    worked_days?: number;
    gross_satang: number;
    sso_satang: number;
    tax_satang: number;
    total_deduction_satang: number;
    net_satang: number;
  };
  payrun: {
    period_year: number;
    period_month: number;
    pay_date: string | null;
    status?: string;
    company?: { name: string | null; address: string | null } | null;
  } | null;
  earnings: PayslipLine[];
  deductions: PayslipLine[];
  /** official figure from the accounting office (null = engine estimate in effect) */
  tax_override?: { tax_satang: number; note: string | null; set_via: string; updated_at: string } | null;
}

// Localized line-type labels; a standard type (salary/ot/sso/tax/…) is translated, while a
// free-form label (an allowance name, a leave code) falls through to the stored text.
const KNOWN_TYPES = new Set([
  'salary', 'ot', 'service_charge', 'tip', 'commission', 'eval_bonus', 'claim',
  'sso', 'tax', 'late', 'absent', 'leave_unpaid', 'travel_leave',
  'student_loan', 'advance', 'guarantee', 'loan', 'provident_fund', 'other', 'allowance',
]);

interface PayslipViewProps {
  data: PayslipDetailData;
  /** print variant tightens spacing for the 9×5.5in slip */
  print?: boolean;
}

export function PayslipView({ data, print = false }: PayslipViewProps) {
  const t = useTranslations('hr.payslip');
  const { payslip, payrun, earnings, deductions } = data;

  const lineLabel = (l: PayslipLine): string => {
    // allowance/claim/commission carry a human label already; standard types are translated.
    if (l.type === 'allowance' || l.type === 'claim' || l.type === 'commission' || l.type === 'eval_bonus') {
      return l.label;
    }
    if (KNOWN_TYPES.has(l.type)) {
      const base = t(`line.${l.type}`);
      // leave/travel lines carry the leave code as label — append it for clarity.
      if ((l.type === 'leave_unpaid' || l.type === 'travel_leave') && l.label && l.label !== l.type) {
        return `${base} (${l.label})`;
      }
      return base;
    }
    return l.label;
  };

  const payTypeLabel = t(`payTypeVal.${payslip.pay_type}`);
  const monthLabel = payrun ? `${String(payrun.period_month).padStart(2, '0')}/${payrun.period_year}` : '—';
  const wrap = print ? 'text-[11px] leading-tight text-black' : 'text-sm text-gray-900 dark:text-white';
  const rowCls = print ? 'py-0.5' : 'py-1.5';
  const divide = print ? 'divide-gray-300' : 'divide-gray-100 dark:divide-gray-700';

  return (
    <div className={`space-y-3 ${wrap}`}>
      {/* company header (สลิปตามสังกัด) */}
      <div className={print ? 'border-b border-gray-400 pb-1.5' : 'border-b border-gray-200 pb-2 dark:border-gray-700'}>
        <div className="flex items-baseline justify-between gap-2">
          <h2 className={print ? 'text-sm font-bold' : 'text-lg font-bold'}>
            {payrun?.company?.name ?? '—'}
          </h2>
          <span className={print ? 'text-[10px] font-semibold uppercase tracking-wide' : 'text-xs font-semibold uppercase tracking-wide text-gray-400'}>
            {t('title')}
          </span>
        </div>
        {payrun?.company?.address && (
          <p className={print ? 'text-[10px] text-gray-700' : 'text-xs text-gray-500 dark:text-gray-400'}>
            {payrun.company.address}
          </p>
        )}
      </div>

      {/* meta */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
        <Meta label={t('employee')} value={payslip.employee_name ?? '—'} print={print} />
        <Meta label={t('period')} value={monthLabel} print={print} />
        <Meta label={t('payType')} value={payTypeLabel} print={print} />
        <Meta label={t('payDate')} value={payrun?.pay_date ?? '—'} print={print} />
      </div>

      {/* earnings */}
      <div>
        <h3 className={print ? 'mb-0.5 text-xs font-semibold' : 'mb-1 text-sm font-semibold text-gray-700 dark:text-gray-200'}>
          {t('earnings')}
        </h3>
        <ul className={`divide-y ${divide}`}>
          {earnings.map((l, i) => (
            <li key={i} className={`flex items-center justify-between ${rowCls}`}>
              <span>{lineLabel(l)}{l.ref && l.type === 'ot' ? ` · ${l.ref}` : ''}</span>
              <span className="tabular-nums">{formatBaht(l.amount_satang)}</span>
            </li>
          ))}
          <li className={`flex items-center justify-between font-semibold ${rowCls}`}>
            <span>{t('gross')}</span>
            <span className="tabular-nums">{formatBaht(payslip.gross_satang)}</span>
          </li>
        </ul>
      </div>

      {/* deductions */}
      <div>
        <h3 className={print ? 'mb-0.5 text-xs font-semibold' : 'mb-1 text-sm font-semibold text-gray-700 dark:text-gray-200'}>
          {t('deductions')}
        </h3>
        {deductions.length === 0 ? (
          <p className={print ? 'text-[10px] text-gray-600' : 'text-xs text-gray-400'}>—</p>
        ) : (
          <ul className={`divide-y ${divide}`}>
            {deductions.map((l, i) => (
              <li key={i} className={`flex items-center justify-between ${rowCls}`}>
                <span>{lineLabel(l)}{l.ref && (l.type === 'late' || l.type === 'absent') ? ` · ${l.ref}` : ''}</span>
                <span className={`tabular-nums ${print ? '' : 'text-red-600 dark:text-red-400'}`}>−{formatBaht(l.amount_satang)}</span>
              </li>
            ))}
            <li className={`flex items-center justify-between font-semibold ${rowCls}`}>
              <span>{t('totalDeduction')}</span>
              <span className="tabular-nums">−{formatBaht(payslip.total_deduction_satang)}</span>
            </li>
          </ul>
        )}
      </div>

      {/* net */}
      <div className={print ? 'flex items-center justify-between border-t-2 border-gray-500 pt-1 text-sm font-bold' : 'flex items-center justify-between border-t-2 border-gray-300 pt-2 text-base font-bold dark:border-gray-600'}>
        <span>{t('net')}</span>
        <span className="tabular-nums">{formatBaht(payslip.net_satang)} ฿</span>
      </div>

      {/* money actually lands in TWO transfers: SC/tip mid-month (15th), salary at month end */}
      {(() => {
        const svSatang = earnings
          .filter((l) => l.type === 'service_charge' || l.type === 'tip')
          .reduce((s, l) => s + l.amount_satang, 0);
        if (svSatang <= 0) return null;
        return (
          <p className={print ? 'text-[9px] text-gray-600' : 'rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'}>
            {t('twoRounds', {
              sv: formatBaht(svSatang),
              salary: formatBaht(payslip.net_satang - svSatang),
            })}
          </p>
        );
      })()}
    </div>
  );
}

function Meta({ label, value, print }: { label: string; value: string; print: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <span className={print ? 'text-gray-600' : 'text-gray-500 dark:text-gray-400'}>{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
