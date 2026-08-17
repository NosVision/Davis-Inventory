'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronRight, CircleCheck, CircleAlert, Clock, Loader2, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

/**
 * Did this period pay everyone it should?
 *
 * Payrun generation is manual and per (company × payroll group), and regenerating is what picks up
 * anyone added since. Both steps are easy to miss and nothing said so: in July 2026 four companies
 * were short, one by 34 people (owner report 2026-08-17). This panel counts expected-vs-paid for
 * the whole period in one place.
 *
 * It is period-aware on purpose. A slice with no payslips before the 25th is not late — payroll is
 * meant to be generated from the 26th — so it reads "ยังไม่ถึงกำหนด", not as a fault. Colouring an
 * ordinary mid-period state red would teach HR to ignore the panel, which is worse than not having
 * one.
 */

type BucketState = 'ok' | 'not_due' | 'not_generated' | 'incomplete';

interface MissingPerson {
  user_id: string;
  name: string;
  stores: string[];
  end_date: string | null;
}

interface Bucket {
  company_id: string | null;
  company_name: string | null;
  payroll_group_id: string | null;
  payroll_group_name: string | null;
  expected: number;
  with_slip: number;
  state: BucketState;
  payrun: { id: string; status: string } | null;
  missing: MissingPerson[];
}

interface CoverageData {
  period: { year: number; month: number; cycle_start: string; cycle_end: string; pay_date: string; closed: boolean };
  buckets: Bucket[];
  totals: { expected: number; with_slip: number; missing: number };
}

export function PeriodCoverage({
  year,
  month,
  isTh,
  /** Bumped by the page after a generate/finalize so the panel re-reads rather than going stale. */
  refreshKey = 0,
}: {
  year: number;
  month: number;
  isTh: boolean;
  refreshKey?: number;
}) {
  const tt = (th: string, en: string) => (isTh ? th : en);
  const [data, setData] = useState<CoverageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/hr/payroll/coverage?year=${year}&month=${month}`);
      if (!res.ok) throw new Error('load failed');
      const j = await res.json();
      setData(j.data as CoverageData);
    } catch {
      setData(null); // a failed check must not render as "all clear"
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2.5 text-xs text-gray-400 dark:border-gray-700">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {tt('กำลังตรวจความครบถ้วนของงวด…', 'Checking period coverage…')}
      </div>
    );
  }
  if (!data) return null;

  const STATE: Record<BucketState, { label: string; row: string; icon: typeof CircleCheck; tone: string }> = {
    ok: {
      label: tt('ครบแล้ว', 'Complete'),
      row: '',
      icon: CircleCheck,
      tone: 'text-emerald-600 dark:text-emerald-400',
    },
    not_due: {
      label: tt('ยังไม่ถึงกำหนดสร้าง', 'Not due yet'),
      row: 'bg-gray-50/60 dark:bg-gray-800/30',
      icon: Clock,
      tone: 'text-gray-500 dark:text-gray-400',
    },
    not_generated: {
      label: tt('ยังไม่ได้สร้าง', 'Not generated'),
      row: 'bg-amber-50/60 dark:bg-amber-900/10',
      icon: CircleAlert,
      tone: 'text-amber-600 dark:text-amber-400',
    },
    incomplete: {
      label: tt('สร้างแล้วแต่คนไม่ครบ', 'Generated but short'),
      row: 'bg-red-50/60 dark:bg-red-900/10',
      icon: TriangleAlert,
      tone: 'text-red-600 dark:text-red-400',
    },
  };

  const needsAttention = data.buckets.filter((b) => b.state === 'not_generated' || b.state === 'incomplete');
  const allClear = needsAttention.length === 0;

  return (
    <details className="group rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800" open={!allClear}>
      <summary className="flex cursor-pointer select-none items-center gap-2 px-3 py-2.5 text-sm [&::-webkit-details-marker]:hidden">
        {allClear ? (
          <CircleCheck className="h-4 w-4 shrink-0 text-emerald-500" />
        ) : (
          <TriangleAlert className="h-4 w-4 shrink-0 text-amber-500" />
        )}
        <span className="min-w-0 font-semibold text-gray-800 dark:text-gray-100">
          {allClear
            ? tt(
                `ออกสลิปครบทุกบริษัทแล้ว · ${data.totals.with_slip}/${data.totals.expected} คน`,
                `Every company is covered · ${data.totals.with_slip}/${data.totals.expected}`
              )
            : tt(
                `ยังไม่ครบ ${needsAttention.length} รายการ · ออกสลิปแล้ว ${data.totals.with_slip}/${data.totals.expected} คน`,
                `${needsAttention.length} slice(s) incomplete · ${data.totals.with_slip}/${data.totals.expected} paid`
              )}
        </span>
        <span className="ml-auto hidden shrink-0 text-xs text-gray-400 sm:inline">
          {tt('งวด', 'Period')} {data.period.cycle_start} – {data.period.cycle_end}
          {!data.period.closed && ` · ${tt('ยังไม่ปิดงวด', 'still open')}`}
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-gray-400 transition-transform group-open:rotate-90" />
      </summary>

      <div className="border-t border-gray-100 dark:border-gray-700">
        <table className="w-full text-sm">
          <thead className="text-left text-xs font-medium text-gray-500 dark:text-gray-400">
            <tr>
              <th className="px-3 py-2">{tt('บริษัท / กลุ่ม', 'Company / group')}</th>
              <th className="px-2 py-2 text-right">{tt('ควรมี', 'Expected')}</th>
              <th className="px-2 py-2 text-right">{tt('มีสลิป', 'Paid')}</th>
              <th className="px-2 py-2 text-right">{tt('ขาด', 'Missing')}</th>
              <th className="px-3 py-2">{tt('สถานะ', 'Status')}</th>
            </tr>
          </thead>
          <tbody>
            {data.buckets.map((b) => {
              const k = `${b.company_id ?? ''}|${b.payroll_group_id ?? ''}`;
              const st = STATE[b.state];
              const Icon = st.icon;
              const expandable = b.missing.length > 0;
              return (
                <tr key={k} className={cn('border-t border-gray-100 align-top dark:border-gray-700/50', st.row)}>
                  <td className="px-3 py-2" colSpan={5}>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <button
                        type="button"
                        disabled={!expandable}
                        onClick={() => setOpen((cur) => (cur === k ? null : k))}
                        className={cn(
                          'min-w-0 text-left font-medium text-gray-800 dark:text-gray-200',
                          expandable && 'hover:text-indigo-600 dark:hover:text-indigo-400'
                        )}
                      >
                        {b.company_name ?? tt('(ไม่ระบุบริษัท)', '(no company)')}
                        {b.payroll_group_name && (
                          <span className="ml-1 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
                            {b.payroll_group_name}
                          </span>
                        )}
                      </button>
                      <span className="ml-auto shrink-0 tabular-nums text-gray-600 dark:text-gray-400">
                        {b.with_slip}/{b.expected}
                        {b.missing.length > 0 && (
                          <span className={cn('ml-2 font-semibold', st.tone)}>
                            {tt('ขาด', 'missing')} {b.missing.length}
                          </span>
                        )}
                      </span>
                      <span className={cn('inline-flex shrink-0 items-center gap-1 text-xs font-medium', st.tone)}>
                        <Icon className="h-3.5 w-3.5" />
                        {st.label}
                      </span>
                      {expandable && (
                        <button
                          type="button"
                          onClick={() => setOpen((cur) => (cur === k ? null : k))}
                          className="shrink-0 text-xs text-indigo-600 hover:underline dark:text-indigo-400"
                        >
                          {open === k ? tt('ซ่อนรายชื่อ', 'Hide names') : tt('ดูรายชื่อ', 'Show names')}
                        </button>
                      )}
                    </div>

                    {open === k && (
                      <ul className="mt-2 space-y-1 rounded-lg bg-white/70 p-2 text-xs dark:bg-gray-900/40">
                        {b.missing.map((m) => (
                          <li key={m.user_id} className="flex flex-wrap items-center gap-x-2 text-gray-600 dark:text-gray-400">
                            <span className="font-medium text-gray-800 dark:text-gray-200">{m.name}</span>
                            <span className="text-gray-400">
                              {m.stores.length > 0 ? m.stores.join(', ') : tt('ไม่สังกัดสาขา', 'no venue')}
                            </span>
                            {m.end_date && (
                              <span className="rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-600 dark:bg-rose-900/30 dark:text-rose-400">
                                {tt('พ้นสภาพ', 'departed')} {m.end_date}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <p className="border-t border-gray-100 px-3 py-2 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
          {data.period.closed
            ? tt(
                'ปิดงวดแล้ว — รายการที่ยังไม่ครบควรกดสร้าง/สร้างซ้ำก่อนปิดยอด (การสร้างซ้ำใบร่างจะดึงพนักงานที่เพิ่มเข้ามาทีหลังมาด้วย)',
                'Period closed — generate or regenerate the short slices before finalizing. Regenerating a draft picks up staff added since.'
              )
            : tt(
                `งวดนี้ปิดวันที่ ${data.period.cycle_end} — ปกติสร้างรอบเงินเดือนช่วงวันที่ 26–29 รายการที่ยังว่างจึงยังไม่ถือว่าตกหล่น`,
                `This period closes ${data.period.cycle_end} — payroll is normally generated on the 26th–29th, so empty slices are not yet late.`
              )}
        </p>
      </div>
    </details>
  );
}
