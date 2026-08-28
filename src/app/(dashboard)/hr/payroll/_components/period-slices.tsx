'use client';

import { useMemo, useState } from 'react';
import { ChevronRight, CircleCheck, Clock, Loader2, Lock, Play, RefreshCw, TriangleAlert, Users } from 'lucide-react';
import { Button, StatusBadge } from '@/components/ui';
import { cn } from '@/lib/utils/cn';

/**
 * One card per SLICE of the selected company and period — the thing HR actually works through.
 *
 * The page used to carry two period axes that never spoke to each other: a company+period+group
 * form at the top that only fed the generate button, and a list of every existing payrun below it
 * that only fed the detail pane. Setting the top to July while the bottom showed August was normal.
 * The group dropdown was worse — an invisible switch, and leaving it on the wrong slice is how ten
 * accounting staff ended up in no July payrun at all (owner report 2026-08-18).
 *
 * So the period is chosen once, above, and everything here belongs to it. A company is paid in
 * slices (the ungrouped default, plus one per payroll group); each slice states how many people it
 * owes, how many it has, and the single action it needs next. Nothing to set before pressing a
 * button — the button sits on the thing it acts upon.
 */

export type SliceState = 'ok' | 'not_due' | 'not_generated' | 'incomplete';

export interface CoverageBucket {
  company_id: string | null;
  company_name: string | null;
  payroll_group_id: string | null;
  payroll_group_name: string | null;
  expected: number;
  with_slip: number;
  state: SliceState;
  /** False when this slice holds someone whose pay the viewer may not see — the payrun POST would
   *  refuse it, so the buttons say why instead of 403-ing on click. */
  can_manage: boolean;
  payrun: { id: string; status: string } | null;
  missing: { user_id: string; name: string; stores: string[]; end_date: string | null }[];
  /** Full-month staff with no start date on file — paid a whole cycle on an assumption. */
  no_start_date: { user_id: string; name: string; status: string | null }[];
  /** Staff at 5+ unauthorized-absence days this cycle — the SAME count the payslip would dock. */
  heavy_absence: { user_id: string; name: string; absent_days: number }[];
}

export interface CoverageData {
  period: { year: number; month: number; cycle_start: string; cycle_end: string; pay_date: string; closed: boolean };
  buckets: CoverageBucket[];
  totals: { expected: number; with_slip: number; missing: number; no_start_date: number };
}

interface PeriodSlicesProps {
  data: CoverageData | null;
  loading: boolean;
  /** Slices of THIS company are the actionable cards; the rest fold away into a summary. */
  companyId: string;
  /** Payrun currently open in the detail pane, so its card can say so. */
  openPayrunId: string | null;
  isTh: boolean;
  busy: boolean;
  onOpen: (payrunId: string) => void;
  onGenerate: (payrollGroupId: string | null) => void;
  /** Jump to another company (used by the "other companies" fold). */
  onPickCompany: (companyId: string) => void;
}

export function PeriodSlices({
  data,
  loading,
  companyId,
  openPayrunId,
  isTh,
  busy,
  onOpen,
  onGenerate,
  onPickCompany,
}: PeriodSlicesProps) {
  const tt = (th: string, en: string) => (isTh ? th : en);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [expandedNoStart, setExpandedNoStart] = useState<string | null>(null);

  const { mine, others } = useMemo(() => {
    const all = data?.buckets ?? [];
    return {
      mine: all.filter((b) => b.company_id === companyId),
      others: all.filter((b) => b.company_id !== companyId),
    };
  }, [data, companyId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-3 text-sm text-gray-400 dark:border-gray-700">
        <Loader2 className="h-4 w-4 animate-spin" />
        {tt('กำลังตรวจรอบจ่ายของงวดนี้…', 'Checking this period…')}
      </div>
    );
  }
  if (!data) return null;

  // Only slices actually behind count as needing attention. Before the period closes an empty slice
  // is simply not due, and colouring that red would teach HR to ignore the page.
  const behind = others.filter((b) => b.state === 'not_generated' || b.state === 'incomplete');
  const sliceLabel = (b: CoverageBucket) =>
    b.payroll_group_name ?? tt('งวดปกติ (ยังไม่จัดกลุ่ม)', 'Default run (ungrouped)');

  return (
    <div className="space-y-2">
      {mine.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-300 px-4 py-6 text-center text-sm text-gray-400 dark:border-gray-700">
          {tt('บริษัทนี้ยังไม่มีพนักงานในงวดนี้', 'This company has no staff in this period')}
        </p>
      ) : (
        <ul className="space-y-2">
          {mine.map((b) => {
            const key = `${b.company_id ?? ''}|${b.payroll_group_id ?? ''}`;
            const isOpen = !!b.payrun && b.payrun.id === openPayrunId;
            const finalized = b.payrun?.status === 'finalized';
            const missing = b.missing.length;
            const noStart = b.no_start_date.length;
            const tone = finalized
              ? 'border-emerald-300 dark:border-emerald-800'
              : b.state === 'incomplete'
                ? 'border-red-300 dark:border-red-800'
                : b.state === 'not_generated'
                  ? 'border-amber-300 dark:border-amber-800'
                  : 'border-gray-200 dark:border-gray-700';

            return (
              <li
                key={key}
                className={cn(
                  'rounded-xl border bg-white p-3 dark:bg-gray-800',
                  tone,
                  isOpen && 'ring-2 ring-indigo-300 dark:ring-indigo-700'
                )}
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-semibold text-gray-900 dark:text-white">
                      {sliceLabel(b)}
                      {b.payrun ? (
                        <StatusBadge
                          tone={finalized ? 'good' : 'warn'}
                          label={finalized ? tt('ปิดยอดแล้ว', 'Finalized') : tt('ร่าง', 'Draft')}
                          icon={finalized ? Lock : undefined}
                        />
                      ) : (
                        <StatusBadge
                          tone={b.state === 'not_due' ? 'neutral' : 'warn'}
                          label={
                            b.state === 'not_due'
                              ? tt('ยังไม่ถึงกำหนดสร้าง', 'Not due yet')
                              : tt('ยังไม่ได้สร้าง', 'Not generated')
                          }
                          icon={b.state === 'not_due' ? Clock : TriangleAlert}
                        />
                      )}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-gray-600 dark:text-gray-400">
                      <span className="inline-flex items-center gap-1">
                        <Users className="h-3.5 w-3.5 text-gray-400" />
                        {tt('ออกสลิปแล้ว', 'Paid')}{' '}
                        <span className="font-semibold tabular-nums">
                          {b.with_slip}/{b.expected}
                        </span>
                      </span>
                      {missing > 0 && (
                        <button
                          type="button"
                          onClick={() => setExpanded((cur) => (cur === key ? null : key))}
                          className={cn(
                            'font-semibold hover:underline',
                            b.state === 'not_due' ? 'text-gray-500 dark:text-gray-400' : 'text-red-600 dark:text-red-400'
                          )}
                        >
                          {tt('ขาด', 'missing')} {missing} {tt('· ดูรายชื่อ', '· show names')}
                        </button>
                      )}
                      {missing === 0 && b.expected > 0 && (
                        <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                          <CircleCheck className="h-3.5 w-3.5" />
                          {tt('ครบ', 'complete')}
                        </span>
                      )}
                    </p>
                    {/* Amber, not red, and never blocking: the run is valid, but every one of these
                        people is being paid a full month on the assumption they worked it. Someone
                        who joined mid-cycle is overpaid and nothing else on this page would say so. */}
                    {noStart > 0 && (
                      <p className="mt-1">
                        <button
                          type="button"
                          onClick={() => setExpandedNoStart((cur) => (cur === key ? null : key))}
                          className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 hover:underline dark:text-amber-400"
                        >
                          <TriangleAlert className="h-3.5 w-3.5" />
                          {tt(
                            `${noStart} คนไม่มีวันเริ่มงาน — จ่ายเต็มเดือน`,
                            `${noStart} with no start date — paid a full month`
                          )}
                          <span className="text-amber-600/70 dark:text-amber-500/70">
                            {tt('· ดูรายชื่อ', '· show names')}
                          </span>
                        </button>
                      </p>
                    )}
                    {/* Same 5+-day count the payslip would dock — checked BEFORE finalizing rather
                        than discovered by opening one slip at a time (owner report 2026-08-26: a
                        slip went from ฿32,333 to ฿9,008 and nothing on any screen said so). */}
                    {b.heavy_absence.length > 0 && (
                      <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                        {tt(
                          `${b.heavy_absence.length} คนมีวันขาด 5 วันขึ้นไปในงวดนี้ — เปิดดูก่อนปิดยอด`,
                          `${b.heavy_absence.length} people have 5+ absent days this period — check before finalizing`
                        )}{' '}
                        <span className="opacity-80">
                          {b.heavy_absence.slice(0, 4).map((h) => `${h.name} (${h.absent_days})`).join(' · ')}
                        </span>
                      </p>
                    )}
                  </div>

                  <div className="ml-auto flex flex-wrap items-center gap-2">
                    {/* The action lives on the slice it acts upon — no dropdown to set first. */}
                    {!b.can_manage && (
                      <span
                        className="inline-flex items-center gap-1 rounded-lg bg-gray-100 px-2 py-1 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-300"
                        title={tt(
                          'กลุ่มนี้มีผู้จัดการเฉพาะ หรือมีพนักงานที่ปิดข้อมูลเงินเดือน',
                          'This slice is owned by someone else, or holds confidential pay'
                        )}
                      >
                        <Lock className="h-3 w-3" />
                        {tt('คุณไม่มีสิทธิ์ทำงวดนี้', 'Not yours to run')}
                      </span>
                    )}
                    {!b.payrun ? (
                      <Button
                        size="sm"
                        icon={<Play className="h-4 w-4" />}
                        disabled={busy || b.expected === 0 || !b.can_manage}
                        onClick={() => onGenerate(b.payroll_group_id)}
                      >
                        {tt('สร้างรอบจ่าย', 'Generate')}
                      </Button>
                    ) : (
                      <>
                        {!finalized && (
                          <Button
                            size="sm"
                            variant="outline"
                            icon={<RefreshCw className="h-4 w-4" />}
                            disabled={busy || !b.can_manage}
                            onClick={() => onGenerate(b.payroll_group_id)}
                            title={tt(
                              'สร้างใหม่ทั้งใบจากข้อมูลล่าสุด — ดึงคนที่เพิ่งเพิ่มเข้ามาด้วย',
                              'Rebuild from current data, picking up staff added since'
                            )}
                          >
                            {tt('คำนวณใหม่', 'Recompute')}
                          </Button>
                        )}
                        <Button size="sm" variant={isOpen ? 'ghost' : 'primary'} disabled={busy} onClick={() => onOpen(b.payrun!.id)}>
                          {isOpen ? tt('กำลังดูอยู่', 'Open below') : tt('เปิดดู', 'Open')}
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {expandedNoStart === key && noStart > 0 && (
                  <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs dark:border-amber-900/60 dark:bg-amber-900/20">
                    <p className="mb-1 text-amber-800 dark:text-amber-300">
                      {tt(
                        'ถ้าคนเหล่านี้เพิ่งเข้างานกลางงวด ระบบจะจ่ายเต็มเดือน — เติมวันเริ่มงานในประวัติพนักงาน แล้วกดคำนวณใหม่',
                        'If any of these joined mid-cycle they are being paid for the whole one. Fill in their start date on the employee record, then recompute.'
                      )}
                    </p>
                    <ul className="space-y-1">
                      {b.no_start_date.map((m) => (
                        <li key={m.user_id} className="flex flex-wrap items-center gap-x-2 text-gray-700 dark:text-gray-300">
                          <span className="font-medium">{m.name}</span>
                          {m.status === 'probation' && (
                            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                              {tt('ทดลองงาน', 'probation')}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {expanded === key && missing > 0 && (
                  <ul className="mt-2 space-y-1 rounded-lg bg-gray-50 p-2 text-xs dark:bg-gray-900/40">
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
              </li>
            );
          })}
        </ul>
      )}

      {/* Other companies in the same period. Folded away — but it opens itself when one of them is
          behind, because "we forgot a whole company" is invisible from inside this one. */}
      {others.length > 0 && (
        <details
          className="group rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
          open={behind.length > 0}
        >
          <summary className="flex cursor-pointer select-none items-center gap-2 px-3 py-2 text-sm [&::-webkit-details-marker]:hidden">
            {behind.length > 0 ? (
              <TriangleAlert className="h-4 w-4 shrink-0 text-amber-500" />
            ) : (
              <CircleCheck className="h-4 w-4 shrink-0 text-emerald-500" />
            )}
            <span className="font-medium text-gray-700 dark:text-gray-200">
              {behind.length > 0
                ? tt(`บริษัทอื่นในงวดนี้ — ยังไม่ครบ ${behind.length} รายการ`, `Other companies — ${behind.length} behind`)
                : tt('บริษัทอื่นในงวดนี้ — ครบแล้ว', 'Other companies — all complete')}
            </span>
            <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-gray-400 transition-transform group-open:rotate-90" />
          </summary>
          <ul className="divide-y divide-gray-100 border-t border-gray-100 dark:divide-gray-700 dark:border-gray-700">
            {others.map((b) => {
              const key = `${b.company_id ?? ''}|${b.payroll_group_id ?? ''}`;
              const isBehind = b.state === 'not_generated' || b.state === 'incomplete';
              return (
                <li key={key} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-sm">
                  <span className="min-w-0 text-gray-800 dark:text-gray-200">
                    {b.company_name ?? tt('(ไม่ระบุบริษัท)', '(no company)')}
                    {b.payroll_group_name && (
                      <span className="ml-1 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
                        {b.payroll_group_name}
                      </span>
                    )}
                  </span>
                  <span className="ml-auto shrink-0 tabular-nums text-gray-600 dark:text-gray-400">
                    {b.with_slip}/{b.expected}
                  </span>
                  {isBehind && (
                    <span className="shrink-0 text-xs font-semibold text-amber-600 dark:text-amber-400">
                      {b.state === 'not_generated' ? tt('ยังไม่ได้สร้าง', 'not generated') : tt('คนไม่ครบ', 'short')}
                    </span>
                  )}
                  {b.company_id && (
                    <button
                      type="button"
                      onClick={() => onPickCompany(b.company_id!)}
                      className="shrink-0 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                    >
                      {tt('ไปที่บริษัทนี้ →', 'Go →')}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </div>
  );
}
