'use client';

import { useLocale, useTranslations } from 'next-intl';
import { formatBaht } from '@/lib/pos/money';
import { useScLineLabel } from '@/components/hr/use-sc-line-label';
import { svPayDate, scEventMonthForPool, payWindows } from '@/lib/hr/pay-cycle';

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
    /** recorded days that were NOT approved leave; null on slips generated before it existed */
    attended_days?: number | null;
    gross_satang: number;
    sso_satang: number;
    tax_satang: number;
    total_deduction_satang: number;
    net_satang: number;
  };
  payrun: {
    period_year: number;
    period_month: number;
    /** the salary period this slip covers — 26th of the previous month to the 25th of this one */
    cycle_start?: string | null;
    cycle_end?: string | null;
    pay_date: string | null;
    status?: string;
    company?: { name: string | null; address: string | null; day_divisor?: number | null } | null;
  } | null;
  earnings: PayslipLine[];
  deductions: PayslipLine[];
  /** official figure from the accounting office (null = engine estimate in effect) */
  tax_override?: { tax_satang: number; note: string | null; set_via: string; updated_at: string } | null;
  /** HR one-time bonus for this payrun (null = none) */
  bonus?: { amount_satang: number; label: string | null } | null;
  /** Service Charge (SV) detail for the round this slip pays: gross allocation + every deduction
   *  line (null = none). `period_month` is this payslip's own month — the pool is allocated at the
   *  start of it and transferred on the 15th, which is the date the panel leads with. */
  service_charge?: {
    period_month: string;
    pay_date: string | null;
    allocated_satang: number;
    deducted_satang: number;
    net_satang: number;
    deductions: { source_type: string; label: string | null; amount_satang: number; carry_satang: number; note: string | null; auto: boolean }[];
  } | null;
  /** free-form register remark for this person on this payrun (null = none) */
  remark?: string | null;
  /** leave-type code → display names, for the leave lines on this slip (absent = show the code) */
  leave_types?: Record<string, { name_th: string; name_en: string }>;
}

// SV deduction source → Thai label (a deduction usually carries its own `label`; this is the
// fallback when it doesn't). Keeps the register's "หัก Sv" lines readable.
const SV_SOURCE_TH: Record<string, string> = {
  stock_penalty: 'ปรับสต๊อก',
  warning: 'ใบเตือน',
  eval: 'ผลประเมิน',
  leave: 'ลา',
  absent: 'ขาดงาน',
  adhoc: 'หักเพิ่มเติม',
  manual: 'หักด้วยมือ',
  // A deduction too large for one month's SV is taken across months. These are the lines that
  // arrive FROM the previous month — the recompute writes them with an English label, which read
  // as machine text on a Thai payslip and never said which direction the carry ran (client ask
  // 2026-08-18). The label here wins, so the direction is stated.
  warning_carry: 'ยกยอดจากเดือนก่อน · ใบเตือน',
  eval_carry: 'ยกยอดจากเดือนก่อน · ผลประเมิน',
  stock_penalty_carry: 'ยกยอดจากเดือนก่อน · ปรับสต๊อก',
};

/** Carried-in lines take the Thai label above even though the row carries its own English one. */
const CARRY_IN_SOURCES = new Set(['warning_carry', 'eval_carry', 'stock_penalty_carry']);

/**
 * The month an SV pool's leave/absence/warning lines are counted over, as 'MM/YYYY'.
 *
 * A pool pays on the 15th of its own month, so only the month BEFORE it is complete by then — that
 * is the window every deduction is measured against (scEventMonthForPool). Naming the pool's own
 * month here would point at days that had not happened when the money left.
 */
function svDeductWindow(periodMonth: string): string {
  const ev = scEventMonthForPool(periodMonth);
  const [y, m] = ev.slice(0, 10).split('-');
  return y && m ? `${m}/${y}` : ev;
}

/** The same window as svDeductWindow, spelled out as dates: '01/07/2026 – 31/07/2026'. */
function svDeductRange(periodMonth: string): string {
  const w = payWindows(periodMonth).find((x) => x.key === 'svCurrent');
  return w ? `${formatDayMonthYear(w.from)} – ${formatDayMonthYear(w.to)}` : svDeductWindow(periodMonth);
}

/** 'YYYY-MM-DD' → 'DD/MM/YYYY'. */
function formatDayMonthYear(date: string): string {
  const [y, m, d] = String(date).slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : String(date);
}

/**
 * When the SV transfer lands, as 'DD/MM/YYYY'. A pool carries its own pay_date once HR finalizes it;
 * before that the field is null, and the transfer date is the one thing this slip must not go quiet
 * about — the whole point of the panel is "how much arrives on the 15th". Falling back to svPayDate
 * keeps the slip saying what the service-charge page says for the same unsaved pool.
 */
function svTransferDate(periodMonth: string, payDate: string | null): string {
  return formatDayMonthYear(payDate ?? svPayDate(periodMonth));
}

/** Pay types whose base is worked_days × rate — for everyone else the count is informational. */
const PAY_BY_DAY = new Set(['pt_daily', 'pt_monthly']);

/**
 * The day count, with the leave days inside it named.
 *
 * The total LEADS: it is what the row's label counts, and what the timesheet's own "วันทำงาน" chip
 * shows for the same cycle — a slip whose headline read 5 against the timesheet's 7 looked like the
 * two disagreed when they never did (client 2026-08-20). The split then explains it: two of those
 * seven were a ลากิจ and a ลาป่วย she clocked on anyway. Shown only when the numbers differ, and the
 * plain total for slips generated before attended_days existed.
 */
function dayCountLabel(workedDays: number, attendedDays: number | null | undefined, t: (k: string, v?: Record<string, string | number>) => string): string {
  if (attendedDays == null || attendedDays >= workedDays) return String(workedDays);
  return t('metaDaysSplit', { total: workedDays, attended: attendedDays, leave: workedDays - attendedDays });
}

// Localized line-type labels; a standard type (salary/ot/sso/tax/…) is translated, while a
// free-form label (an allowance name, a leave code) falls through to the stored text.
const KNOWN_TYPES = new Set([
  'salary', 'ot', 'service_charge', 'tip', 'commission', 'eval_bonus', 'claim',
  'sso', 'tax', 'late', 'absent', 'leave_unpaid', 'travel_leave', 'travel_absent',
  'student_loan', 'advance', 'guarantee', 'loan', 'provident_fund', 'other', 'allowance',
]);

/**
 * The human label for one payslip line, given a translator scoped to `hr.payslip`.
 *
 * Exported because the downloadable PDF needs the SAME wording: line labels are stored as machine
 * keys ('salary', 'sso', 'absent'), and the PDF printed them raw — an employee's Thai payslip
 * listed "salary / sso / absent" in English and did not match the screen it was downloaded from.
 * A react-pdf tree cannot call hooks, so the translator is handed in rather than read here.
 */
export function payslipLineLabel(
  l: PayslipLine,
  t: (key: string) => string,
  leaveName?: (code: string) => string | undefined
): string {
  // allowance/claim/commission/adjustment carry a human label already; standard types are translated.
  if (l.type === 'allowance' || l.type === 'claim' || l.type === 'commission' || l.type === 'eval_bonus' || l.type === 'adjustment') {
    return l.label;
  }
  if (KNOWN_TYPES.has(l.type)) {
    const base = t(`line.${l.type}`);
    // Leave/travel lines carry the leave-type CODE as their label. Name it — the code is a database
    // key, and printing it left "ลาไม่รับเงิน (personal)" on a Thai payslip. Falls back to the code
    // when the type has since been deleted, which is still better than nothing beside the amount.
    if ((l.type === 'leave_unpaid' || l.type === 'travel_leave') && l.label && l.label !== l.type) {
      return `${base} (${leaveName?.(l.label) || l.label})`;
    }
    return base;
  }
  return l.label;
}

/** Day count from a leave-line ref ("{leave_id}:{N}d") — null when the ref isn't that shape. */
function leaveDaysFromRef(ref: string | null | undefined): number | null {
  if (!ref) return null;
  const m = /:(\d+(?:\.\d+)?)d$/.exec(ref);
  return m ? Number(m[1]) : null;
}

interface PayslipViewProps {
  data: PayslipDetailData;
  /** print variant tightens spacing for the 9×5.5in slip */
  print?: boolean;
}

export function PayslipView({ data, print = false }: PayslipViewProps) {
  const t = useTranslations('hr.payslip');
  const locale = useLocale();
  // SV lines were stored with English labels at recompute time — localize them on the way out.
  const scLineLabel = useScLineLabel();
  const { payslip, payrun, earnings, deductions } = data;

  // Leave types carry only Thai and English names, so the partial locales (my/lo) read Thai — the
  // same direction the rest of this slip family falls back in, and the language these categories
  // are actually administered in.
  const leaveName = (code: string): string | undefined => {
    const lt = data.leave_types?.[code];
    return lt ? (locale === 'en' ? lt.name_en : lt.name_th) : undefined;
  };
  const lineLabel = (l: PayslipLine): string => payslipLineLabel(l, t, leaveName);

  // The formula behind a computed line, rendered from the stored machine ref — the number's
  // provenance at a glance (HR ask 2026-07-14: "อยากเห็นการแจกแจงทุกตัวเลข"). The engine docks
  // leave at rate÷day_divisor × days and travel at allowance÷day_divisor × days (payroll.ts);
  // the divisor is per-company config (default 30), so it must come from the payload, not a
  // hardcoded 30.
  const dayDivisor = payrun?.company?.day_divisor || 30;
  const dailyRateSatang = payslip.rate_satang ? payslip.rate_satang / dayDivisor : 0;
  const lineFormula = (l: PayslipLine): string | null => {
    // Mid-period hire/leaver — the engine prorated the base over the employment window and
    // stamped "27/30d" on the line; show the day count so the number is followable.
    if (l.type === 'salary' && l.ref) {
      const m = /^(\d+)\/(\d+)d$/.exec(l.ref);
      if (m && payslip.rate_satang) {
        return t('formula.prorate', {
          days: m[1],
          divisor: m[2],
          daily: formatBaht(Math.round(payslip.rate_satang / Number(m[2]))),
        });
      }
    }
    // Prorated travel allowance carries "travel:27/30d".
    if (l.type === 'allowance' && l.ref) {
      const m = /^travel:(\d+)\/(\d+)d$/.exec(l.ref);
      if (m) return t('formula.prorateTravel', { days: m[1], divisor: m[2] });
    }
    if (l.type === 'ot' && l.ref) return l.ref; // "12.50h"
    if (l.type === 'late' && l.ref) return l.ref; // "3x"
    if (l.type === 'absent' && l.ref) return t('formula.absent', { days: l.ref.replace(/d$/, '') });
    if (l.type === 'leave_unpaid') {
      const days = leaveDaysFromRef(l.ref);
      if (days != null && dailyRateSatang > 0) {
        return t('formula.leave', { days, daily: formatBaht(Math.round(dailyRateSatang)), divisor: dayDivisor });
      }
      if (days != null) return t('formula.days', { days });
    }
    if (l.type === 'travel_leave') {
      const days = leaveDaysFromRef(l.ref);
      if (days != null) return t('formula.travel', { days, divisor: dayDivisor });
    }
    // travel_absent carries a bare "{N}d" ref (no leave id to prefix it).
    if (l.type === 'travel_absent' && l.ref) {
      const days = Number(l.ref.replace(/d$/, ''));
      if (Number.isFinite(days)) return t('formula.travel', { days, divisor: dayDivisor });
    }
    return null;
  };

  // SC actually paid on this slip (tip is a separate pool and a separate line — the panel below
  // explains SC only, so the staleness check must compare like with like).
  const svEarningSatang = earnings
    .filter((l) => l.type === 'service_charge')
    .reduce((s, l) => s + l.amount_satang, 0);

  const payTypeLabel = t(`payTypeVal.${payslip.pay_type}`);
  const monthLabel = payrun ? `${String(payrun.period_month).padStart(2, '0')}/${payrun.period_year}` : '—';
  // 'YYYY-MM-DD' → 'DD/MM/YYYY'
  const payDateLabel = (() => {
    const d = payrun?.pay_date;
    if (!d) return '—';
    const [y, m, dd] = String(d).slice(0, 10).split('-');
    return y && m && dd ? `${dd}/${m}/${y}` : String(d);
  })();
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
        {/* Salary absence is counted over this window; the SV panel counts its own calendar month.
            One slip therefore read "ขาดงาน 16 วัน" beside "ขาดงาน (11 วัน)" in the SV — both right,
            five days of late July falling in the salary cycle but in the PREVIOUS SV pool (client
            2026-08-20). Neither figure explains itself unless the slip says what it measured. */}
        {payrun?.cycle_start && payrun?.cycle_end && (
          <Meta
            label={t('metaCycle')}
            value={`${formatDayMonthYear(payrun.cycle_start)} – ${formatDayMonthYear(payrun.cycle_end)}`}
            print={print}
          />
        )}
        <Meta label={t('payType')} value={payTypeLabel} print={print} />
        <Meta label={t('payDate')} value={payDateLabel} print={print} />
        {!print && (payslip.rate_satang ?? 0) > 0 && (
          <>
            <Meta label={t('metaRate')} value={`${formatBaht(payslip.rate_satang as number)} ฿`} print={print} />
            <Meta label={t('metaDailyRate', { divisor: dayDivisor })} value={`${formatBaht(Math.round((payslip.rate_satang as number) / dayDivisor))} ฿`} print={print} />
          </>
        )}
        {/* worked_days is the count of days with a real time record. For pt_daily/pt_monthly it IS
            the pay base (payroll.ts computeBaseSalary), so it belongs beside the money. For monthly
            staff it drives nothing — the salary is a flat month and absence is itemised as its own
            deduction — yet "วันทำงาน 7" on a slip paying a full month reads as an underpayment or a
            mistake (client report 2026-08-20: rostered 22, punched 7, paid the full 27,000). Same
            label, two meanings; name the one that applies. */}
        {!print && payslip.worked_days != null && (
          <Meta
            label={PAY_BY_DAY.has(payslip.pay_type) ? t('metaWorkedDays') : t('metaRecordedDays')}
            value={dayCountLabel(payslip.worked_days, payslip.attended_days, t)}
            print={print}
          />
        )}
      </div>

      {/* free-form register remark (legacy Payment file Remark column) — screen only */}
      {!print && data.remark && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          📝 {data.remark}
        </p>
      )}

      {/* earnings */}
      <div>
        <h3 className={print ? 'mb-0.5 text-xs font-semibold' : 'mb-1 text-sm font-semibold text-gray-700 dark:text-gray-200'}>
          {t('earnings')}
        </h3>
        <ul className={`divide-y ${divide}`}>
          {earnings.map((l, i) => (
            <li key={i} className={`flex items-center justify-between gap-2 ${rowCls}`}>
              <span className="min-w-0">
                {lineLabel(l)}
                {l.type === 'adjustment' && !print && (
                  <span className="ml-1.5 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-300">
                    {t('adjBadge')}
                  </span>
                )}
                {lineFormula(l) ? <span className="text-gray-400"> · {lineFormula(l)}</span> : null}
                {l.type === 'adjustment' && l.reason && !print ? <span className="text-gray-400"> · {l.reason}</span> : null}
              </span>
              <span className="shrink-0 tabular-nums">{formatBaht(l.amount_satang)}</span>
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
              <li key={i} className={`flex items-center justify-between gap-2 ${rowCls}`}>
                <span className="min-w-0">
                  {lineLabel(l)}
                  {l.type === 'adjustment' && !print && (
                    <span className="ml-1.5 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-300">
                      {t('adjBadge')}
                    </span>
                  )}
                  {lineFormula(l) ? <span className="text-gray-400"> · {lineFormula(l)}</span> : null}
                  {l.type === 'adjustment' && l.reason && !print ? <span className="text-gray-400"> · {l.reason}</span> : null}
                </span>
                <span className={`shrink-0 tabular-nums ${print ? '' : 'text-red-600 dark:text-red-400'}`}>−{formatBaht(l.amount_satang)}</span>
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

      {/* Service Charge (SV) breakdown — how the SV net was derived (gross allocation minus each
          deduction, e.g. stock penalties). Screen only; the printed slip stays clean. */}
      {!print && data.service_charge && (data.service_charge.allocated_satang > 0 || data.service_charge.deductions.length > 0) && (
        <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-3 dark:border-violet-800 dark:bg-violet-900/10">
          {/* Lead with the transfer, not the accrual. The reader's question is "how much lands on
              the 15th"; which month's takings funded it explains the deduction lines below, so it
              stays — one size down, after the number, never in front of it. Leading with the
              earning period is what made an August slip look like it was reporting July. */}
          <h3 className="mb-0.5 text-sm font-semibold text-violet-700 dark:text-violet-300">
            {t('sc.title')}
            <span className="ml-1.5 font-normal text-violet-600/80 dark:text-violet-400/80">
              · {t('sc.paidOn', { date: svTransferDate(data.service_charge.period_month, data.service_charge.pay_date) })}
            </span>
          </h3>
          <p className="mb-1 text-xs text-violet-600/70 dark:text-violet-400/70">
            {t('sc.round')} · {t('sc.deductWindow', { month: svDeductWindow(data.service_charge.period_month) })}
          </p>
          {/* The two spans, printed together.
              The salary cycle was already stated at the top of the slip and the SV window here, half
              a page apart — so nobody put them side by side, and the difference between them read as
              the system contradicting itself. They only overlap for the last few days of the month:
              1–25 of the previous month docks SV but not this cycle, 1–25 of this month docks this
              cycle but reaches SV a round later. That is the whole of the confusion, said once. */}
          {payrun?.cycle_start && payrun?.cycle_end && (
            <div className="mb-1.5 rounded-md bg-white/70 px-2 py-1.5 text-[11px] leading-relaxed dark:bg-gray-800/40">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-gray-600 dark:text-gray-300">
                <span>{t('sc.windowSalary')}</span>
                <span className="tabular-nums font-medium">
                  {formatDayMonthYear(payrun.cycle_start)} – {formatDayMonthYear(payrun.cycle_end)}
                </span>
              </div>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-violet-700 dark:text-violet-300">
                <span>{t('sc.windowSv')}</span>
                <span className="tabular-nums font-medium">
                  {svDeductRange(data.service_charge.period_month)}
                </span>
              </div>
              <p className="mt-1 text-gray-500 dark:text-gray-400">{t('sc.windowWhy')}</p>
            </div>
          )}
          <ul className="divide-y divide-violet-200/60 dark:divide-violet-800/60">
            <li className="flex items-center justify-between py-1">
              <span>{t('sc.allocated')}</span>
              <span className="tabular-nums">{formatBaht(data.service_charge.allocated_satang)}</span>
            </li>
            {data.service_charge.deductions.map((d, i) => (
              <li key={i} className="flex items-start justify-between gap-2 py-1">
                <span className="min-w-0">
                  {(CARRY_IN_SOURCES.has(d.source_type) ? SV_SOURCE_TH[d.source_type] : scLineLabel(d)) || SV_SOURCE_TH[d.source_type] || d.source_type}
                  {d.note ? <span className="text-gray-400"> · {d.note}</span> : null}
                  {d.carry_satang > 0 ? (
                    <span className="text-amber-600 dark:text-amber-400"> · {t('sc.carry', { amount: formatBaht(d.carry_satang) })}</span>
                  ) : null}
                </span>
                <span className="shrink-0 tabular-nums text-red-600 dark:text-red-400">−{formatBaht(d.amount_satang)}</span>
              </li>
            ))}
            <li className="flex items-center justify-between py-1 font-semibold">
              <span>{t('sc.net')}</span>
              <span className="tabular-nums text-violet-700 dark:text-violet-300">{formatBaht(data.service_charge.net_satang)}</span>
            </li>
          </ul>
          {/* A deduction larger than the month's SV is taken across months, and each line says what
              it carried. Nobody should have to add those up — least of all when the net is 0 and the
              carry is the only thing left to understand. */}
          {(() => {
            const carried = data.service_charge.deductions.reduce((s, x) => s + (x.carry_satang || 0), 0);
            if (carried <= 0) return null;
            return (
              <p className="mt-1 rounded-md bg-amber-100 px-2 py-1.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                {t('sc.carryTotal', { amount: formatBaht(carried) })}
              </p>
            );
          })()}
          {/* The money on a slip is a SNAPSHOT taken when the payrun was generated; this panel reads
              the pool as it stands now. Edit the pool afterwards and the two drift apart — the same
              "two SV numbers on one slip" shape that sent the client hunting for a double-count. Say
              it outright instead of letting the reader arbitrate between two silent figures. */}
          {data.service_charge.net_satang !== svEarningSatang && (
            <p className="mt-2 rounded-md bg-amber-100 px-2 py-1.5 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
              {t('sc.stale', { paid: formatBaht(svEarningSatang), pool: formatBaht(data.service_charge.net_satang) })}
            </p>
          )}
        </div>
      )}

      {/* Money lands in TWO transfers: SC/tip on the 15th, salary at month end. What the reader
          needs is the amount per transfer and the month's total — the SV's earning period is a
          detail of the panel above, not of this line (client 2026-08-19: "โฟกัสแค่ว่ายอดที่จะจ่าย
          วันที่ 15 กี่บาท แล้วเอาไปรวมกับหลังวันที่ 26 ให้เป็นยอดรวมของเดือน 8").

          net_satang is ALREADY the month-end transfer alone — payroll.ts subtracts SC/tip from it
          because they leave the bank on a different day. Subtracting them again here understated
          the salary transfer by exactly the SV, and presented that short figure as the month's
          total: an August slip promised 17,691.67 for a 22,358.34 transfer. */}
      {(() => {
        const svSatang = earnings
          .filter((l) => l.type === 'service_charge' || l.type === 'tip')
          .reduce((s, l) => s + l.amount_satang, 0);
        if (svSatang <= 0) return null;
        const svDate = data.service_charge
          ? svTransferDate(data.service_charge.period_month, data.service_charge.pay_date)
          : null;
        return (
          <p className={print ? 'text-[9px] text-gray-600' : 'rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'}>
            {t('twoRounds', {
              sv: formatBaht(svSatang),
              svDate: svDate ?? t('twoRoundsMidMonth'),
              salary: formatBaht(payslip.net_satang),
              salaryDate: payDateLabel,
              total: formatBaht(payslip.net_satang + svSatang),
              month: monthLabel,
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
