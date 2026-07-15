'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import {
  Clock,
  CheckCircle2,
  LogOut,
  CalendarOff,
  AlarmClock,
  CalendarDays,
  Wallet,
  Eye,
  EyeOff,
  Sparkles,
  CalendarRange,
  PieChart,
  Gauge,
  Coffee,
  HelpCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { formatTimeBangkok } from '@/lib/utils/date';

// ---- API shape (mirrors /api/hr/ess/dashboard) ----
interface DaySummary {
  business_date: string;
  is_day_off: boolean;
  first_in: string | null;
  last_out: string | null;
  worked_min: number | null;
  late_min: number | null;
  absent: boolean;
  scheduled: boolean;
  ot_min: number;
}
interface ShiftInfo {
  label: string | null;
  start_time: string;
  end_time: string;
}
interface Dashboard {
  today: DaySummary | null;
  today_last_punch: { type: 'in' | 'out' | 'break_start' | 'break_end'; ts: string } | null;
  today_shift: ShiftInfo | null;
  next_shift: (ShiftInfo & { work_date: string }) | null;
  cycle: {
    from: string;
    to: string;
    scheduled_days: number;
    totals: { work_days: number; absent_days: number; late_days: number; worked_min: number; ot_min: number };
  };
  pay: {
    latest: { period_year: number; period_month: number; net_satang: number; source: 'payrun' | 'imported'; pay_date: string | null } | null;
    history: { period_year: number; period_month: number; net_satang: number }[];
    ytd: { months: number; net_satang: number; gross_satang: number; tax_satang: number; sso_satang: number };
    sc: { period_month: string; pay_date: string | null; announced_at: string | null; net_satang: number } | null;
  };
  leave: {
    year: number;
    types: { id: string; code: string; name_th: string; name_en: string; quota: number | null; used: number; remaining: number | null }[];
    monthly: number[];
  } | null;
  penalties: { month_points: number; month_baht: number };
}

const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TH_DOW = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
const EN_DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HIDE_MONEY_KEY = 'me-hide-money';
// The 3 leave types employees actually track at a glance; others live on /me/leaves.
const LEAVE_SPOTLIGHT = ['vacation', 'sick', 'personal'];

const toH = (min: number) => (min / 60).toFixed(1);
const hhmm = (t: string) => t.slice(0, 5);
const baht = (satang: number) => `฿${Math.round(satang / 100).toLocaleString()}`;

// Absolute instant (ms) of a shift boundary on a business date. A small-hours time (before 06:00)
// belongs to the NEXT calendar day, and an end at/before the start crosses midnight — same
// convention as the server time engine, so the "forgot to clock out?" hint fires correctly on
// overnight shifts too.
function shiftInstantMs(businessDate: string, time: string, afterMs?: number): number {
  const hhmmss = time.length === 5 ? `${time}:00` : time;
  let ms = new Date(`${businessDate}T${hhmmss}+07:00`).getTime();
  if (Number(time.slice(0, 2)) < 6) ms += 86_400_000;
  if (afterMs != null && ms <= afterMs) ms += 86_400_000;
  return ms;
}
const FORGOT_IN_GRACE_MS = 15 * 60_000; // nag only 15 min after shift start
const FORGOT_OUT_GRACE_MS = 30 * 60_000; // nag only 30 min after shift end

function monthLabel(month: number, isTh: boolean): string {
  return (isTh ? TH_MONTHS : EN_MONTHS)[month - 1] ?? String(month);
}
function dateLabel(dateStr: string, isTh: boolean): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${(isTh ? TH_DOW : EN_DOW)[dow]} ${d} ${monthLabel(m, isTh)}`;
}

// ---- Small chart primitives (inline SVG so both themes just work via currentColor) ----
function ProgressRing({ pct, value, sub }: { pct: number; value: string; sub: string }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, pct));
  return (
    <div className="relative h-[76px] w-[76px] shrink-0">
      <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" strokeWidth="6" className="stroke-gray-100 dark:stroke-gray-700" />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - clamped)}
          className="stroke-indigo-500 transition-[stroke-dashoffset] duration-700 dark:stroke-indigo-400"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-sm font-bold tabular-nums text-gray-900 dark:text-white">{value}</span>
        <span className="text-[9px] text-gray-400">{sub}</span>
      </div>
    </div>
  );
}

function BarSpark({ points, labels, tone }: { points: number[]; labels: string[]; tone: string }) {
  const max = Math.max(...points, 1);
  return (
    <div className="flex items-end gap-1">
      {points.map((v, i) => (
        <div key={i} className="flex flex-1 flex-col items-center gap-0.5" title={labels[i]}>
          <div
            className={cn('w-full rounded-sm transition-all', tone, v === 0 && 'bg-gray-100 dark:bg-gray-700')}
            style={{ height: `${Math.max(3, Math.round((v / max) * 36))}px` }}
          />
          <span className="text-[8px] leading-none text-gray-400">{labels[i]}</span>
        </div>
      ))}
    </div>
  );
}

function CardShell({ icon: Icon, title, action, children, className }: { icon: typeof Clock; title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800', className)}>
      <div className="flex items-center justify-between">
        <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
          <Icon className="h-3.5 w-3.5" />
          {title}
        </p>
        {action}
      </div>
      {children}
    </div>
  );
}

function StatCell({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg bg-gray-50 px-2.5 py-1.5 dark:bg-gray-900/40">
      <p className="text-[10px] text-gray-400 dark:text-gray-500">{label}</p>
      <p className={cn('text-sm font-semibold tabular-nums text-gray-900 dark:text-white', tone)}>{value}</p>
    </div>
  );
}

// Redesigned /me summary (owner ask 2026-07-15): 4 cards along the time axis —
// realtime "now" (live worked-hours ticker + today/next shift + check-in CTA),
// this pay cycle (26–25), latest pay + SC, and this year (leave quotas, penalties, YTD).
// One consolidated fetch (/api/hr/ess/dashboard) instead of one call per widget.
export function MeSummary() {
  const isTh = useLocale() === 'th';
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<Dashboard | null>(null);
  const [hideMoney, setHideMoney] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    setHideMoney(localStorage.getItem(HIDE_MONEY_KEY) === '1');
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/hr/ess/dashboard');
        if (!res.ok) throw new Error();
        const json = await res.json();
        if (alive) setData((json.data ?? null) as Dashboard | null);
      } catch {
        /* summary is best-effort — never block the hub */
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // 30s clock tick — drives the live worked-hours counter AND the time-aware CTA/hints
  // (break window, "forgot to clock in/out?"), so it runs whenever the card has data.
  const onDuty = Boolean(data?.today?.first_in && !data?.today?.last_out);
  useEffect(() => {
    if (!data) return;
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [data]);

  const toggleMoney = () => {
    setHideMoney((prev) => {
      localStorage.setItem(HIDE_MONEY_KEY, prev ? '0' : '1');
      return !prev;
    });
  };
  const money = (satang: number) => (hideMoney ? '฿ ••••' : baht(satang));

  const spotlightLeaves = useMemo(() => {
    const types = data?.leave?.types ?? [];
    const picked = types.filter((t) => LEAVE_SPOTLIGHT.includes(t.code) && t.quota != null);
    return picked.length ? picked : types.filter((t) => t.quota != null).slice(0, 3);
  }, [data]);

  if (loading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-40 animate-pulse rounded-2xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800" />
        ))}
      </div>
    );
  }
  if (!data) return null;

  const { today, today_last_punch, today_shift, next_shift, cycle, pay, leave, penalties } = data;
  const onBreak = onDuty && today_last_punch?.type === 'break_start';

  // Shift boundary instants for the time-aware hints/buttons (null when no shift today).
  const shiftStartMs = today && today_shift ? shiftInstantMs(today.business_date, today_shift.start_time) : null;
  const shiftEndMs = today && today_shift ? shiftInstantMs(today.business_date, today_shift.end_time, shiftStartMs ?? undefined) : null;
  const forgotIn = Boolean(today?.scheduled && !today?.first_in && shiftStartMs != null && nowMs > shiftStartMs + FORGOT_IN_GRACE_MS);
  const forgotOut = Boolean(onDuty && shiftEndMs != null && nowMs > shiftEndMs + FORGOT_OUT_GRACE_MS);
  const beforeShiftEnd = shiftEndMs == null || nowMs < shiftEndMs;

  // Today's headline state (same states as before the redesign, plus "on break").
  const state = (() => {
    if (onBreak && today_last_punch) {
      return {
        icon: Coffee,
        tone: 'text-sky-600 dark:text-sky-400',
        bg: 'bg-sky-50 dark:bg-sky-900/20',
        label: isTh ? 'กำลังพัก' : 'On break',
        detail: `${isTh ? 'เริ่มพัก' : 'since'} ${formatTimeBangkok(today_last_punch.ts)} · ${Math.max(0, Math.floor((nowMs - new Date(today_last_punch.ts).getTime()) / 60_000))} ${isTh ? 'นาที' : 'min'}`,
      };
    }
    if (today?.is_day_off) {
      return { icon: CalendarOff, tone: 'text-gray-500 dark:text-gray-400', bg: 'bg-gray-50 dark:bg-gray-900/40', label: isTh ? 'วันหยุด' : 'Day off', detail: '' };
    }
    if (today?.first_in && today?.last_out) {
      return {
        icon: LogOut,
        tone: 'text-emerald-600 dark:text-emerald-400',
        bg: 'bg-emerald-50 dark:bg-emerald-900/20',
        label: isTh ? 'ออกงานแล้ว' : 'Clocked out',
        detail: `${formatTimeBangkok(today.first_in)}–${formatTimeBangkok(today.last_out)} · ${toH(today.worked_min ?? 0)} ${isTh ? 'ชม.' : 'h'}`,
      };
    }
    if (today?.first_in) {
      const late = (today.late_min ?? 0) > 0;
      return {
        icon: CheckCircle2,
        tone: late ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400',
        bg: late ? 'bg-amber-50 dark:bg-amber-900/20' : 'bg-emerald-50 dark:bg-emerald-900/20',
        label: isTh ? 'เข้างานแล้ว' : 'Clocked in',
        detail: `${formatTimeBangkok(today.first_in)}${late ? (isTh ? ` · สาย ${today.late_min} นาที` : ` · late ${today.late_min}m`) : ''}`,
      };
    }
    if (today?.scheduled) {
      return { icon: AlarmClock, tone: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-900/20', label: isTh ? 'ยังไม่เข้างาน' : 'Not clocked in', detail: isTh ? 'มีกะวันนี้' : 'Scheduled today' };
    }
    return { icon: Clock, tone: 'text-gray-400', bg: 'bg-gray-50 dark:bg-gray-900/40', label: isTh ? 'วันนี้' : 'Today', detail: isTh ? 'ไม่มีกะ' : 'No shift' };
  })();
  const StateIcon = state.icon;

  const workedLiveMin = onDuty && today?.first_in ? Math.max(0, Math.floor((nowMs - new Date(today.first_in).getTime()) / 60_000)) : 0;

  const attendPct = cycle.scheduled_days > 0 ? cycle.totals.work_days / cycle.scheduled_days : 0;
  const cycleLabel = `${Number(cycle.from.slice(8, 10))} ${monthLabel(Number(cycle.from.slice(5, 7)), isTh)} – ${Number(cycle.to.slice(8, 10))} ${monthLabel(Number(cycle.to.slice(5, 7)), isTh)}`;

  const payHistory = pay.history;
  const scMonth = pay.sc ? monthLabel(Number(pay.sc.period_month.slice(5, 7)), isTh) : '';
  const leaveMonthly = leave?.monthly ?? [];

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {/* ① Now — realtime */}
      <CardShell icon={Clock} title={isTh ? 'ตอนนี้' : 'Now'}>
        <div className="flex items-center gap-3">
          <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', state.bg, state.tone)}>
            <StateIcon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className={cn('text-sm font-semibold', state.tone)}>{state.label}</p>
            {state.detail && <p className="truncate text-xs text-gray-500 dark:text-gray-400">{state.detail}</p>}
          </div>
        </div>
        {onDuty && (
          <p className="text-2xl font-bold tabular-nums tracking-tight text-gray-900 dark:text-white">
            {Math.floor(workedLiveMin / 60)}
            <span className="text-sm font-medium text-gray-400"> {isTh ? 'ชม.' : 'h'} </span>
            {workedLiveMin % 60}
            <span className="text-sm font-medium text-gray-400"> {isTh ? 'นาที' : 'm'}</span>
            <span className={cn('ml-2 align-middle text-[10px] font-medium uppercase', onBreak ? 'text-sky-500' : 'text-emerald-500')}>
              ● {onBreak ? (isTh ? 'พักอยู่' : 'on break') : isTh ? 'กำลังทำงาน' : 'on duty'}
            </span>
          </p>
        )}
        <div className="space-y-1 text-xs text-gray-500 dark:text-gray-400">
          <p className="flex items-center gap-1.5">
            <CalendarDays className="h-3.5 w-3.5 shrink-0" />
            {isTh ? 'กะวันนี้' : 'Today'}:{' '}
            <span className="font-medium text-gray-900 dark:text-white">
              {today?.is_day_off ? (isTh ? 'วันหยุด' : 'Day off') : today_shift ? `${hhmm(today_shift.start_time)}–${hhmm(today_shift.end_time)}` : isTh ? 'ไม่มีกะ' : 'No shift'}
            </span>
          </p>
          <p className="flex items-center gap-1.5">
            <CalendarRange className="h-3.5 w-3.5 shrink-0" />
            {isTh ? 'กะถัดไป' : 'Next shift'}:{' '}
            <span className="font-medium text-gray-900 dark:text-white">
              {next_shift ? `${dateLabel(next_shift.work_date, isTh)} · ${hhmm(next_shift.start_time)}–${hhmm(next_shift.end_time)}` : '—'}
            </span>
          </p>
        </div>
        {(forgotIn || forgotOut) && (
          <div className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
            <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {forgotIn
                ? isTh
                  ? `ลืมเช็คอินหรือเปล่า? กะวันนี้เริ่ม ${today_shift ? hhmm(today_shift.start_time) : ''} น. แล้ว`
                  : `Forgot to clock in? Your shift started at ${today_shift ? hhmm(today_shift.start_time) : ''}`
                : isTh
                  ? `ลืมเช็คเอาท์หรือเปล่า? กะจบ ${today_shift ? hhmm(today_shift.end_time) : ''} น. แล้ว`
                  : `Forgot to clock out? Your shift ended at ${today_shift ? hhmm(today_shift.end_time) : ''}`}{' '}
              <Link href="/me/attendance-requests" className="font-medium underline underline-offset-2">
                {isTh ? 'ขอแก้เวลา' : 'Fix my time'}
              </Link>
            </span>
          </div>
        )}
        {onBreak ? (
          <Link
            href="/me/checkin"
            className="mt-auto inline-flex items-center justify-center gap-1.5 rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sky-700"
          >
            <Coffee className="h-4 w-4" />
            {isTh ? 'เลิกพัก' : 'End break'}
          </Link>
        ) : onDuty ? (
          <div className="mt-auto flex gap-2">
            {beforeShiftEnd && (
              <Link
                href="/me/checkin"
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-600 transition-colors hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-900/20 dark:text-sky-400"
              >
                <Coffee className="h-4 w-4" />
                {isTh ? 'เริ่มพัก' : 'Start break'}
              </Link>
            )}
            <Link
              href="/me/checkin"
              className="inline-flex flex-1 items-center justify-center rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-600 transition-colors hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-400"
            >
              {isTh ? 'เช็คเอาท์' : 'Clock out'}
            </Link>
          </div>
        ) : today?.scheduled && !today?.first_in ? (
          <Link
            href="/me/checkin"
            className="mt-auto inline-flex items-center justify-center rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-700"
          >
            {isTh ? 'เช็คอินเข้างาน' : 'Clock in'}
          </Link>
        ) : (
          <Link
            href="/me/checkin"
            className="mt-auto inline-flex items-center justify-center rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-700/40"
          >
            {isTh ? 'เปิดหน้าเช็คอิน' : 'Open check-in'}
          </Link>
        )}
      </CardShell>

      {/* ② This pay cycle (26–25) */}
      <CardShell icon={PieChart} title={`${isTh ? 'งวดนี้' : 'This cycle'} · ${cycleLabel}`}>
        <div className="flex items-center gap-4">
          <ProgressRing
            pct={attendPct}
            value={`${cycle.totals.work_days}/${cycle.scheduled_days}`}
            sub={isTh ? 'วันทำงาน' : 'days'}
          />
          <div className="grid flex-1 grid-cols-2 gap-1.5">
            <StatCell label={isTh ? 'ชั่วโมงรวม' : 'Hours'} value={toH(cycle.totals.worked_min)} />
            <StatCell label="OT" value={`${toH(cycle.totals.ot_min)} ${isTh ? 'ชม.' : 'h'}`} />
            <StatCell
              label={isTh ? 'มาสาย' : 'Late'}
              value={`${cycle.totals.late_days} ${isTh ? 'วัน' : 'd'}`}
              tone={cycle.totals.late_days > 0 ? 'text-amber-600 dark:text-amber-400' : undefined}
            />
            <StatCell
              label={isTh ? 'ขาดงาน' : 'Absent'}
              value={`${cycle.totals.absent_days} ${isTh ? 'วัน' : 'd'}`}
              tone={cycle.totals.absent_days > 0 ? 'text-red-600 dark:text-red-400' : undefined}
            />
          </div>
        </div>
      </CardShell>

      {/* ③ Pay — latest slip + SC + 6-period trend */}
      <CardShell
        icon={Wallet}
        title={isTh ? 'เงินเดือน' : 'Pay'}
        action={
          <button type="button" onClick={toggleMoney} className="text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-300" aria-label="toggle money">
            {hideMoney ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        }
      >
        {pay.latest ? (
          <>
            <div>
              <p className="text-2xl font-bold tabular-nums tracking-tight text-emerald-600 dark:text-emerald-400">{money(pay.latest.net_satang)}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {isTh ? 'สุทธิงวด' : 'Net'} {monthLabel(pay.latest.period_month, isTh)} {isTh ? String(pay.latest.period_year + 543).slice(2) : pay.latest.period_year}
                {pay.latest.pay_date && ` · ${isTh ? 'จ่าย' : 'paid'} ${dateLabel(pay.latest.pay_date, isTh)}`}
              </p>
            </div>
            {pay.sc && (
              <p className="flex items-center gap-1.5 rounded-lg bg-violet-50 px-2.5 py-1.5 text-xs text-violet-700 dark:bg-violet-900/20 dark:text-violet-300">
                <Sparkles className="h-3.5 w-3.5 shrink-0" />
                {isTh ? `SC งวด ${scMonth}` : `SC ${scMonth}`}{' '}
                <span className="font-semibold tabular-nums">{money(pay.sc.net_satang)}</span>
                {pay.sc.pay_date && <span className="text-violet-500/80">· {isTh ? 'จ่าย' : 'pays'} {dateLabel(pay.sc.pay_date, isTh)}</span>}
              </p>
            )}
            {payHistory.length > 1 && !hideMoney && (
              <BarSpark
                points={payHistory.map((h) => h.net_satang)}
                labels={payHistory.map((h) => monthLabel(h.period_month, isTh))}
                tone="bg-emerald-400/80 dark:bg-emerald-500/70"
              />
            )}
            <Link href="/me/payslips" className="mt-auto text-xs font-medium text-teal-600 hover:underline dark:text-teal-400">
              {isTh ? 'ดูสลิปทั้งหมด →' : 'All payslips →'}
            </Link>
          </>
        ) : (
          <p className="text-sm text-gray-400">{isTh ? 'ยังไม่มีสลิปเงินเดือน' : 'No payslips yet'}</p>
        )}
      </CardShell>

      {/* ④ This year — leave quotas, monthly usage, penalties, YTD income */}
      <CardShell icon={Gauge} title={`${isTh ? 'ปีนี้' : 'This year'} ${leave ? (isTh ? leave.year + 543 : leave.year) : ''}`}>
        {spotlightLeaves.length > 0 && (
          <div className="space-y-1.5">
            {spotlightLeaves.map((t) => {
              const pct = t.quota ? Math.min(1, t.used / t.quota) : 0;
              // Traffic-light by % remaining, same thresholds as /me/leaves: >50% green, >20% amber, else red.
              const remainPct = (1 - pct) * 100;
              const barColor = remainPct > 50 ? 'bg-emerald-400' : remainPct > 20 ? 'bg-amber-400' : 'bg-rose-400';
              return (
                <div key={t.id} className="flex items-center gap-2 text-xs">
                  <span className="w-16 shrink-0 truncate text-gray-500 dark:text-gray-400">{isTh ? t.name_th : t.name_en}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
                    <div className={cn('h-full rounded-full', barColor)} style={{ width: `${pct * 100}%` }} />
                  </div>
                  <span className="w-14 shrink-0 text-right tabular-nums text-gray-900 dark:text-white">
                    {t.remaining ?? '∞'}<span className="text-gray-400">/{t.quota ?? '∞'}</span>
                  </span>
                </div>
              );
            })}
          </div>
        )}
        {leaveMonthly.some((v) => v > 0) && (
          <BarSpark
            points={leaveMonthly}
            labels={(isTh ? TH_MONTHS : EN_MONTHS).map((m) => m.slice(0, isTh ? 4 : 1))}
            tone="bg-sky-400/80 dark:bg-sky-500/70"
          />
        )}
        {(penalties.month_points > 0 || penalties.month_baht > 0) && (
          <p className="flex items-center gap-1.5 rounded-lg bg-rose-50 px-2.5 py-1.5 text-xs text-rose-600 dark:bg-rose-900/20 dark:text-rose-400">
            <Gauge className="h-3.5 w-3.5 shrink-0" />
            {isTh ? 'แต้มสต๊อกเดือนนี้' : 'Stock points'} <span className="font-semibold tabular-nums">{penalties.month_points}</span>
            {penalties.month_baht > 0 && (
              <span>· {isTh ? 'ค่าปรับ' : 'fines'} <span className="font-semibold tabular-nums">฿{penalties.month_baht.toLocaleString()}</span></span>
            )}
          </p>
        )}
        {pay.ytd.months > 0 && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {isTh ? 'รายได้สะสมปีนี้' : 'YTD income'}{' '}
            <span className="font-semibold tabular-nums text-gray-900 dark:text-white">{money(pay.ytd.net_satang)}</span>{' '}
            ({pay.ytd.months} {isTh ? 'งวด' : 'periods'})
            {!hideMoney && (
              <span className="text-gray-400"> · {isTh ? 'ภาษี' : 'tax'} {baht(pay.ytd.tax_satang)} · {isTh ? 'ปกส.' : 'SSO'} {baht(pay.ytd.sso_satang)}</span>
            )}
          </p>
        )}
        <Link href="/me/leaves" className="mt-auto text-xs font-medium text-teal-600 hover:underline dark:text-teal-400">
          {isTh ? 'ขอลา / ดูโควตา →' : 'Leave & quotas →'}
        </Link>
      </CardShell>
    </div>
  );
}
