'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useLocale } from 'next-intl';
import {
  Loader2,
  Users,
  CheckCircle2,
  Palmtree,
  CircleSlash,
  AlarmClock,
  Inbox,
  Copy,
  RefreshCw,
  CalendarClock,
  PartyPopper,
  ShieldAlert,
  Cake,
  UserPlus,
  UserMinus,
  AlertTriangle,
  Wallet,
  ClipboardCheck,
  ChevronRight,
} from 'lucide-react';
import { Button, toast } from '@/components/ui';
import { cn } from '@/lib/utils/cn';
import {
  AttendanceDonut,
  VenueStackedBars,
  MonthTrendChart,
  LeaveByTypeChart,
  type VenueRow,
  type TrendDay,
  type ChartLabels,
} from './_components/overview-charts';

// §P5.3 HR/manager dashboard (redesign) — the full picture for TODAY + THIS MONTH within the
// caller's scope: KPI tiles, attendance donut, per-venue breakdown, month-to-date trend, leave
// mix, HR counters, payroll/eval snapshots, and pending-approval queues — plus the original
// name lists, copy-to-LINE summary, and forward-looking reminders. Self-contained locale strings.
interface Person { user_id: string; name: string }
interface Daily { business_date: string; headcount: number; checked_in: Person[]; on_leave: Person[]; not_in: Person[] }
interface StoreOpt { id: string; store_name: string | null; store_code: string | null }
interface ProbationAlert { user_id: string; name: string; date: string; days_left: number }
interface AnnivAlert { user_id: string; name: string; date: string; years: number; days_left: number }
interface SsoPendingAlert { user_id: string; name: string; date: string; days_over: number }
interface BirthdayAlert { user_id: string; name: string; date: string; days_left: number }
interface Alerts { window_days: number; probation_ending: ProbationAlert[]; anniversaries: AnnivAlert[]; birthdays?: BirthdayAlert[]; sso_pending?: SsoPendingAlert[] }
interface Overview {
  business_date: string;
  month: string;
  today: { headcount: number; checked_in: number; on_leave: number; not_in: number; late: number; by_store: VenueRow[] };
  month_summary: {
    days: TrendDay[];
    leave_by_type: { code: string; name_th: string; name_en: string; days: number }[];
    new_hires: number;
    offboarded: number;
    warnings: number;
    pending: { leaves: number; ot: number; attendance: number; claims: number; profile_changes: number | null };
    payroll: { runs: number; finalized: number; slips: number; net_total_satang: number | null } | null;
    evaluation: { periods: number; assignments: number; submitted: number } | null;
  };
}

const inputCls =
  'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-white';

// Chart palette — status colors are fixed across modes (always paired with a label); the blue /
// chrome tokens swap with `.dark`. Consumed by _components/overview-charts via var(--viz-*).
const VIZ_VARS = `
.hr-viz{--viz-good:#0ca30c;--viz-warn:#fab219;--viz-serious:#ec835a;--viz-crit:#d03b3b;--viz-blue:#2a78d6;--viz-grid:#e5e7eb;--viz-axis:#d1d5db;--viz-ink:#6b7280;--viz-ink-strong:#111827;--viz-surface:#ffffff;--viz-hover:rgba(0,0,0,0.04);--viz-border:#e5e7eb;--viz-tooltip-bg:#ffffff}
.dark .hr-viz{--viz-blue:#3987e5;--viz-grid:#374151;--viz-axis:#4b5563;--viz-ink:#9ca3af;--viz-ink-strong:#f9fafb;--viz-surface:#1f2937;--viz-hover:rgba(255,255,255,0.06);--viz-border:#374151;--viz-tooltip-bg:#1f2937}
`;

function todayBangkok(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
}
// ISO business_date (YYYY-MM-DD) → dd/mm/yyyy for display; month (YYYY-MM) → mm/yyyy.
function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return d ? `${d}/${m}/${y}` : iso;
}
function fmtMonth(iso: string): string {
  const [y, m] = iso.split('-');
  return m ? `${m}/${y}` : iso;
}
// birthday display: day/month only (the year is the person's business, not the dashboard's)
function fmtDM(iso: string): string {
  const [, m, d] = iso.split('-');
  return d ? `${d}/${m}` : iso;
}
const baht = (satang: number) => `฿${(satang / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

export default function HrDailyDashboardPage() {
  const isTh = useLocale() === 'th';
  const L = isTh
    ? { title: 'แดชบอร์ด HR', subtitle: 'ภาพรวมวันนี้และเดือนนี้ — ในความดูแลของคุณ', date: 'วันที่', store: 'สาขา', allStores: 'ทุกสาขา', refresh: 'รีเฟรช', headcount: 'พนักงาน', checkedIn: 'เข้างานแล้ว', onLeave: 'ลา', notIn: 'ยังไม่เข้า', late: 'มาสาย', pending: 'รออนุมัติ', copyLine: 'คัดลอกสรุปไปไลน์', copied: 'คัดลอกแล้ว', copyFailed: 'คัดลอกไม่สำเร็จ', loadFailed: 'โหลดไม่สำเร็จ', none: '—', people: 'คน', daysWord: 'วัน', todaySection: 'วันนี้', monthSection: 'เดือนนี้', attendanceToday: 'สัดส่วนการเข้างานวันนี้', byVenue: 'แบ่งตามสาขา (วันนี้)', byVenueHint: 'แตะแถบเพื่อกรองสาขา', dailyTrend: 'การเข้างานรายวัน (สะสมทั้งเดือน)', leaveByType: 'วันลาตามประเภท', noLeave: 'ไม่มีวันลาเดือนนี้', newHires: 'พนักงานใหม่', offboarded: 'พ้นสภาพ', warningsMonth: 'ใบเตือน', payrollCard: 'เงินเดือนงวดนี้', payrollNone: 'ยังไม่สร้างรอบเงินเดือน', runsWord: 'รอบ', finalizedWord: 'ปิดงวดแล้ว', slipsWord: 'สลิป', netTotal: 'สุทธิรวม', netHidden: 'ซ่อนยอดสุทธิ (ความเป็นส่วนตัว)', evalCard: 'การประเมินเดือนนี้', evalNone: 'ยังไม่มีรอบประเมิน', submittedWord: 'ส่งแล้ว', pendingCard: 'คิวรออนุมัติ', pendingLeaves: 'คำขอลา', pendingOt: 'ขอโอที', pendingAtt: 'ขอแก้เวลา', pendingClaims: 'เบิกค่าใช้จ่าย', pendingProfile: 'แก้ข้อมูลส่วนตัว', alerts: 'แจ้งเตือน HR', probationEnding: 'ครบทดลองงาน', anniversary: 'ครบรอบงาน', birthday: 'วันเกิดพนักงาน', ssoPending: 'ครบทดลองงานแล้ว ยังไม่เข้าประกันสังคม', ssoPendingHint: 'ขึ้นทะเบียน สปส. แล้วติ๊ก "เข้าประกันสังคม" ในโปรไฟล์พนักงาน', overDays: (n: number) => (n === 0 ? 'ครบวันนี้' : `เกินมา ${n} วัน`), inDays: (n: number) => (n === 0 ? 'วันนี้' : `อีก ${n} วัน`), yearsWord: (n: number) => `${n} ปี` }
    : { title: 'HR dashboard', subtitle: 'The full picture for today and this month — within your scope', date: 'Date', store: 'Store', allStores: 'All stores', refresh: 'Refresh', headcount: 'Headcount', checkedIn: 'Checked in', onLeave: 'On leave', notIn: 'Not in', late: 'Late', pending: 'Pending', copyLine: 'Copy summary for LINE', copied: 'Copied', copyFailed: 'Copy failed', loadFailed: 'Load failed', none: '—', people: '', daysWord: 'days', todaySection: 'Today', monthSection: 'This month', attendanceToday: "Today's attendance mix", byVenue: 'By venue (today)', byVenueHint: 'Tap a bar to filter by venue', dailyTrend: 'Daily attendance (month to date)', leaveByType: 'Leave days by type', noLeave: 'No leave this month', newHires: 'New hires', offboarded: 'Offboarded', warningsMonth: 'Warnings', payrollCard: 'Payroll this period', payrollNone: 'No payrun yet', runsWord: 'runs', finalizedWord: 'finalized', slipsWord: 'slips', netTotal: 'Net total', netHidden: 'Net hidden (privacy)', evalCard: 'Evaluation this month', evalNone: 'No evaluation period', submittedWord: 'submitted', pendingCard: 'Pending approvals', pendingLeaves: 'Leave requests', pendingOt: 'OT requests', pendingAtt: 'Time corrections', pendingClaims: 'Claims', pendingProfile: 'Profile changes', alerts: 'HR reminders', probationEnding: 'Probation ending', anniversary: 'Work anniversary', birthday: 'Employee birthdays', ssoPending: 'Past probation, not in SSO', ssoPendingHint: 'Register with SSO, then tick "SSO enrolled" on the employee profile', overDays: (n: number) => (n === 0 ? 'due today' : `${n}d over`), inDays: (n: number) => (n === 0 ? 'today' : `in ${n}d`), yearsWord: (n: number) => `${n}y` };

  const chartLabels: ChartLabels = {
    checkedIn: L.checkedIn,
    onLeave: L.onLeave,
    notIn: L.notIn,
    late: L.late,
    days: L.daysWord,
    people: L.people,
  };

  const [date, setDate] = useState(() => todayBangkok());
  const [storeId, setStoreId] = useState('');
  const [stores, setStores] = useState<StoreOpt[]>([]);
  const [data, setData] = useState<Daily | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [alerts, setAlerts] = useState<Alerts | null>(null);
  const [loading, setLoading] = useState(true);
  const reqSeq = useRef(0); // guards against an out-of-order load() overwriting fresher state

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/hr/manageable-stores');
        setStores(((await res.json()).data ?? []) as StoreOpt[]);
      } catch { /* store filter is optional */ }
    })();
  }, []);

  // forward-looking reminders (probation ending / anniversaries) — scope follows the store filter
  useEffect(() => {
    (async () => {
      try {
        const qs = storeId ? `?store_id=${storeId}` : '';
        const res = await fetch(`/api/hr/dashboard/alerts${qs}`);
        if (res.ok) setAlerts((await res.json()).data as Alerts);
      } catch { /* alerts are best-effort */ }
    })();
  }, [storeId]);

  const load = useCallback(async () => {
    const seq = ++reqSeq.current;
    setLoading(true);
    try {
      const qs = new URLSearchParams({ business_date: date });
      if (storeId) qs.set('store_id', storeId);
      const [dailyRes, overviewRes] = await Promise.all([
        fetch(`/api/hr/dashboard/daily?${qs.toString()}`),
        fetch(`/api/hr/dashboard/overview?${qs.toString()}`),
      ]);
      const dailyJson = await dailyRes.json();
      if (seq !== reqSeq.current) return; // a newer load() superseded this response
      if (!dailyRes.ok) { toast({ type: 'error', title: dailyJson?.error || L.loadFailed }); setData(null); setOverview(null); return; }
      setData(dailyJson.data as Daily);
      const overviewJson = await overviewRes.json();
      if (seq !== reqSeq.current) return;
      setOverview(overviewRes.ok ? (overviewJson.data as Overview) : null);
    } catch { if (seq === reqSeq.current) toast({ type: 'error', title: L.loadFailed }); }
    finally { if (seq === reqSeq.current) setLoading(false); }
  }, [date, storeId, L.loadFailed]);

  useEffect(() => { load(); }, [load]);

  const lineText = useMemo(() => {
    if (!data) return '';
    const storeName = storeId ? stores.find((s) => s.id === storeId)?.store_name ?? '' : (isTh ? 'ทุกสาขา' : 'All stores');
    const names = (list: Person[]) => (list.length ? list.map((p) => p.name).join(', ') : L.none);
    return [
      `📊 ${L.title} ${fmtDate(data.business_date)}${storeName ? ` · ${storeName}` : ''}`,
      `👥 ${L.headcount} ${data.headcount} ${isTh ? L.people : ''}`.trim(),
      `✅ ${L.checkedIn} ${data.checked_in.length}: ${names(data.checked_in)}`,
      `🌴 ${L.onLeave} ${data.on_leave.length}: ${names(data.on_leave)}`,
      `⛔ ${L.notIn} ${data.not_in.length}: ${names(data.not_in)}`,
    ].join('\n');
    // L is a pure function of isTh (rebuilt each render) — depend on isTh, not the fresh L ref.
  }, [data, storeId, stores, isTh]); // eslint-disable-line react-hooks/exhaustive-deps

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(lineText);
      toast({ type: 'success', title: L.copied });
    } catch { toast({ type: 'error', title: L.copyFailed }); }
  };

  const pendingTotal = overview
    ? overview.month_summary.pending.leaves +
      overview.month_summary.pending.ot +
      overview.month_summary.pending.attendance +
      overview.month_summary.pending.claims +
      (overview.month_summary.pending.profile_changes ?? 0)
    : 0;

  const stats = overview
    ? [
        { key: L.headcount, value: overview.today.headcount, icon: Users, color: 'text-gray-600 dark:text-gray-300', bg: 'bg-gray-100 dark:bg-gray-700' },
        { key: L.checkedIn, value: overview.today.checked_in, icon: CheckCircle2, color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-900/30' },
        { key: L.onLeave, value: overview.today.on_leave, icon: Palmtree, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-900/30' },
        { key: L.notIn, value: overview.today.not_in, icon: CircleSlash, color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-900/30' },
        { key: L.late, value: overview.today.late, icon: AlarmClock, color: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-50 dark:bg-orange-900/30' },
        { key: L.pending, value: pendingTotal, icon: Inbox, color: 'text-indigo-600 dark:text-indigo-400', bg: 'bg-indigo-50 dark:bg-indigo-900/30' },
      ]
    : [];

  const monthCounters = overview
    ? [
        { key: L.newHires, value: overview.month_summary.new_hires, icon: UserPlus, tone: 'text-emerald-600 dark:text-emerald-400' },
        { key: L.offboarded, value: overview.month_summary.offboarded, icon: UserMinus, tone: 'text-red-600 dark:text-red-400' },
        { key: L.warningsMonth, value: overview.month_summary.warnings, icon: AlertTriangle, tone: 'text-amber-600 dark:text-amber-400' },
      ]
    : [];

  const pendingRows = overview
    ? ([
        { label: L.pendingLeaves, value: overview.month_summary.pending.leaves, href: '/hr/leaves' },
        { label: L.pendingOt, value: overview.month_summary.pending.ot, href: '/hr/requests' },
        { label: L.pendingAtt, value: overview.month_summary.pending.attendance, href: '/hr/requests' },
        { label: L.pendingClaims, value: overview.month_summary.pending.claims, href: '/hr/claims' },
        ...(overview.month_summary.pending.profile_changes !== null
          ? [{ label: L.pendingProfile, value: overview.month_summary.pending.profile_changes, href: '/hr/profile-requests' }]
          : []),
      ] as { label: string; value: number; href: string }[])
    : [];

  const leaveItems = overview
    ? overview.month_summary.leave_by_type.map((t) => ({ code: t.code, name: isTh ? t.name_th : t.name_en, days: t.days }))
    : [];

  const Card = ({ title, hint, children, className }: { title: string; hint?: string; children: React.ReactNode; className?: string }) => (
    <div className={cn('rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800', className)}>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{title}</h3>
        {hint && <span className="text-[11px] text-gray-400">{hint}</span>}
      </div>
      {children}
    </div>
  );

  const PersonList = ({ title, list, tone }: { title: string; list: Person[]; tone: string }) => (
    <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-2 flex items-center justify-between">
        <h2 className={cn('text-sm font-semibold', tone)}>{title}</h2>
        <span className="tabular-nums text-xs text-gray-400">{list.length}</span>
      </div>
      {list.length === 0 ? (
        <p className="text-sm text-gray-400">{L.none}</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {list.map((p) => (
            <li key={p.user_id} className="rounded-full bg-gray-50 px-2.5 py-1 text-xs text-gray-700 dark:bg-gray-700/50 dark:text-gray-200">{p.name}</li>
          ))}
        </ul>
      )}
    </div>
  );

  const SectionHeading = ({ label, extra }: { label: string; extra?: React.ReactNode }) => (
    <div className="flex items-center justify-between gap-2 pt-2">
      <h2 className="text-base font-bold text-gray-900 dark:text-white">{label}</h2>
      {extra}
    </div>
  );

  return (
    <div className="hr-viz mx-auto max-w-6xl space-y-4 p-4">
      <style>{VIZ_VARS}</style>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">{L.title}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{L.subtitle}</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col text-xs text-gray-600 dark:text-gray-400">{L.date}
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={cn('mt-1', inputCls)} />
          </label>
          <label className="flex flex-col text-xs text-gray-600 dark:text-gray-400">{L.store}
            <select value={storeId} onChange={(e) => setStoreId(e.target.value)} className={cn('mt-1', inputCls)}>
              <option value="">{L.allStores}</option>
              {stores.map((s) => (<option key={s.id} value={s.id}>{s.store_name || s.store_code}</option>))}
            </select>
          </label>
          <Button variant="outline" type="button" onClick={load} icon={<RefreshCw className="h-4 w-4" />}>{L.refresh}</Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : (
        <>
          {overview && (
            <>
              <SectionHeading
                label={`${L.todaySection} · ${fmtDate(overview.business_date)}`}
                extra={<Button type="button" onClick={copy} icon={<Copy className="h-4 w-4" />}>{L.copyLine}</Button>}
              />

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {stats.map((s) => (
                  <div key={s.key} className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
                    <div className={cn('mb-2 flex h-9 w-9 items-center justify-center rounded-lg', s.bg)}>
                      <s.icon className={cn('h-5 w-5', s.color)} />
                    </div>
                    <p className="text-2xl font-bold tabular-nums text-gray-900 dark:text-white">{s.value}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{s.key}</p>
                  </div>
                ))}
              </div>

              <div className="grid gap-3 lg:grid-cols-5">
                <Card title={L.attendanceToday} className="lg:col-span-2">
                  <AttendanceDonut
                    checkedIn={overview.today.checked_in}
                    onLeave={overview.today.on_leave}
                    notIn={overview.today.not_in}
                    labels={chartLabels}
                  />
                </Card>
                {overview.today.by_store.length > 0 && (
                  <Card title={L.byVenue} hint={L.byVenueHint} className="lg:col-span-3">
                    <VenueStackedBars
                      rows={overview.today.by_store}
                      labels={chartLabels}
                      onSelect={(id) => setStoreId((cur) => (cur === id ? '' : id))}
                    />
                  </Card>
                )}
              </div>
            </>
          )}

          {data && (
            <div className="grid gap-3 sm:grid-cols-3">
              <PersonList title={L.checkedIn} list={data.checked_in} tone="text-emerald-600 dark:text-emerald-400" />
              <PersonList title={L.onLeave} list={data.on_leave} tone="text-amber-600 dark:text-amber-400" />
              <PersonList title={L.notIn} list={data.not_in} tone="text-red-600 dark:text-red-400" />
            </div>
          )}

          {overview && (
            <>
              <SectionHeading label={`${L.monthSection} · ${fmtMonth(overview.month)}`} />

              <div className="grid gap-3 lg:grid-cols-3">
                <Card title={L.dailyTrend} className="lg:col-span-2">
                  <MonthTrendChart days={overview.month_summary.days} labels={chartLabels} />
                </Card>

                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-3">
                    {monthCounters.map((c) => (
                      <div key={c.key} className="rounded-xl border border-gray-200 bg-white p-3 text-center dark:border-gray-700 dark:bg-gray-800">
                        <c.icon className={cn('mx-auto mb-1 h-4 w-4', c.tone)} />
                        <p className="text-xl font-bold tabular-nums text-gray-900 dark:text-white">{c.value}</p>
                        <p className="text-[11px] leading-tight text-gray-500 dark:text-gray-400">{c.key}</p>
                      </div>
                    ))}
                  </div>

                  <Card title={L.payrollCard}>
                    {overview.month_summary.payroll ? (
                      <Link href="/hr/payroll" className="block">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <Wallet className="h-4 w-4 text-indigo-500" />
                            <span className="text-sm text-gray-700 dark:text-gray-200">
                              {overview.month_summary.payroll.finalized}/{overview.month_summary.payroll.runs} {L.finalizedWord} · {overview.month_summary.payroll.slips} {L.slipsWord}
                            </span>
                          </div>
                          <ChevronRight className="h-4 w-4 text-gray-400" />
                        </div>
                        {overview.month_summary.payroll.net_total_satang !== null ? (
                          <p className="mt-1 text-lg font-bold tabular-nums text-gray-900 dark:text-white">
                            {baht(overview.month_summary.payroll.net_total_satang)}
                            <span className="ml-1 text-xs font-normal text-gray-400">{L.netTotal}</span>
                          </p>
                        ) : (
                          <p className="mt-1 text-sm text-gray-400">{L.netHidden}</p>
                        )}
                      </Link>
                    ) : (
                      <Link href="/hr/payroll" className="flex items-center justify-between text-sm text-gray-400">
                        {L.payrollNone}
                        <ChevronRight className="h-4 w-4" />
                      </Link>
                    )}
                  </Card>

                  {overview.month_summary.evaluation !== null && (
                    <Card title={L.evalCard}>
                      <Link href="/hr/evaluation" className="block">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <ClipboardCheck className="h-4 w-4 text-indigo-500" />
                            <span className="text-sm tabular-nums text-gray-700 dark:text-gray-200">
                              {overview.month_summary.evaluation.submitted}/{overview.month_summary.evaluation.assignments} {L.submittedWord}
                            </span>
                          </div>
                          <ChevronRight className="h-4 w-4 text-gray-400" />
                        </div>
                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${overview.month_summary.evaluation.assignments > 0 ? Math.round((overview.month_summary.evaluation.submitted / overview.month_summary.evaluation.assignments) * 100) : 0}%`,
                              background: 'var(--viz-blue)',
                            }}
                          />
                        </div>
                      </Link>
                    </Card>
                  )}
                </div>
              </div>

              <div className="grid gap-3 lg:grid-cols-2">
                <Card title={L.leaveByType}>
                  {leaveItems.length > 0 ? (
                    <LeaveByTypeChart items={leaveItems} labels={chartLabels} />
                  ) : (
                    <p className="py-6 text-center text-sm text-gray-400">{L.noLeave}</p>
                  )}
                </Card>

                <Card title={L.pendingCard}>
                  <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                    {pendingRows.map((r) => (
                      <li key={r.label}>
                        <Link href={r.href} className="flex items-center justify-between py-2 text-sm hover:opacity-80">
                          <span className="text-gray-700 dark:text-gray-200">{r.label}</span>
                          <span className="flex items-center gap-1.5">
                            <span
                              className={cn(
                                'rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums',
                                r.value > 0
                                  ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400'
                                  : 'bg-gray-100 text-gray-400 dark:bg-gray-700'
                              )}
                            >
                              {r.value}
                            </span>
                            <ChevronRight className="h-4 w-4 text-gray-400" />
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Card>
              </div>
            </>
          )}
        </>
      )}

      {alerts && (alerts.probation_ending.length > 0 || alerts.anniversaries.length > 0 || (alerts.birthdays?.length ?? 0) > 0 || (alerts.sso_pending?.length ?? 0) > 0) && (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-200">{L.alerts}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {(alerts.sso_pending?.length ?? 0) > 0 && (
              <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-4 sm:col-span-2 dark:border-rose-800 dark:bg-rose-900/10">
                <div className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-rose-700 dark:text-rose-400">
                  <ShieldAlert className="h-4 w-4" /> {L.ssoPending}
                </div>
                <p className="mb-2 text-[11px] text-rose-600/80 dark:text-rose-400/80">{L.ssoPendingHint}</p>
                <ul className="grid gap-1 sm:grid-cols-2">
                  {(alerts.sso_pending ?? []).map((a) => (
                    <li key={a.user_id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate text-gray-800 dark:text-gray-100">{a.name}</span>
                      <span className="whitespace-nowrap text-xs text-rose-600 dark:text-rose-400">{a.date} · {L.overDays(a.days_over)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {alerts.probation_ending.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 dark:border-amber-800 dark:bg-amber-900/10">
                <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-amber-700 dark:text-amber-400">
                  <CalendarClock className="h-4 w-4" /> {L.probationEnding}
                </div>
                <ul className="space-y-1">
                  {alerts.probation_ending.map((a) => (
                    <li key={a.user_id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate text-gray-800 dark:text-gray-100">{a.name}</span>
                      <span className="whitespace-nowrap text-xs text-amber-600 dark:text-amber-400">{a.date} · {L.inDays(a.days_left)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {alerts.anniversaries.length > 0 && (
              <div className="rounded-xl border border-violet-200 bg-violet-50/50 p-4 dark:border-violet-800 dark:bg-violet-900/10">
                <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-violet-700 dark:text-violet-400">
                  <PartyPopper className="h-4 w-4" /> {L.anniversary}
                </div>
                <ul className="space-y-1">
                  {alerts.anniversaries.map((a) => (
                    <li key={a.user_id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate text-gray-800 dark:text-gray-100">{a.name}</span>
                      <span className="whitespace-nowrap text-xs text-violet-600 dark:text-violet-400">{L.yearsWord(a.years)} · {L.inDays(a.days_left)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(alerts.birthdays?.length ?? 0) > 0 && (
              <div className="rounded-xl border border-pink-200 bg-pink-50/50 p-4 dark:border-pink-800 dark:bg-pink-900/10">
                <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-pink-700 dark:text-pink-400">
                  <Cake className="h-4 w-4" /> {L.birthday}
                </div>
                <ul className="space-y-1">
                  {(alerts.birthdays ?? []).map((a) => (
                    <li key={a.user_id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate text-gray-800 dark:text-gray-100">{a.name}</span>
                      <span className="whitespace-nowrap text-xs text-pink-600 dark:text-pink-400">{fmtDM(a.date)} · {L.inDays(a.days_left)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
