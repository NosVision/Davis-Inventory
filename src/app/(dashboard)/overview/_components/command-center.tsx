'use client';

import { useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useTranslations, useLocale } from 'next-intl';
import { cn } from '@/lib/utils/cn';
import { formatNumber } from '@/lib/utils/format';
import {
  AlertTriangle,
  CalendarClock,
  ClipboardCheck,
  Coins,
  UserCheck,
  UserMinus,
  Users,
  CheckCircle2,
  FileWarning,
  ArrowRightLeft,
  Repeat,
  Banknote,
  ListTodo,
  ChevronRight,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types — structural subset of the page's StoreStatus (owner rows)
// ---------------------------------------------------------------------------

export interface CcStoreStatus {
  id: string;
  name: string;
  isCentral: boolean;
  activeDeposits: number;
  expiringDeposits: number;
  pendingExplanations: number;
  pendingApprovals: number;
  pendingWithdrawals: number;
  pendingTransfers: number;
  pendingIncomingTransfers: number;
  borrowsToApprove: number;
  lendsToApprove: number;
  pendingConfirm: number;
  pendingDeposits: number;
  commissionThisMonth: number;
  depositsThisMonth: number;
  lastStockCheck: string | null;
}

export interface HrPerson { user_id: string; name: string; store_ids?: string[] }
export interface HrLeavePerson extends HrPerson { leave_th?: string | null; leave_en?: string | null }
export interface HrStoreLite { id: string; name: string }
export interface HrDaily {
  headcount: number;
  stores?: HrStoreLite[];
  checked_in: HrPerson[];
  on_leave: HrLeavePerson[];
  not_in: HrPerson[];
}

interface CommandCenterProps {
  stores: CcStoreStatus[];
  expiringDeposits: number;      // global (respects store filter)
  commissionThisMonth: number;   // global
  hrDaily: HrDaily | null;
  hrLoaded: boolean;             // false while HR is still loading / no access
  tasksCount: number | null;
}

type Sev = 'crit' | 'warn' | 'info' | 'good' | 'accent';

// Tone → tailwind classes (semantic state, kept separate from the indigo accent)
const TONE: Record<Sev, { text: string; bar: string; iconBg: string; iconText: string }> = {
  crit:   { text: 'text-red-600 dark:text-red-400',       bar: 'bg-red-500',     iconBg: 'bg-red-50 dark:bg-red-900/25',       iconText: 'text-red-600 dark:text-red-400' },
  warn:   { text: 'text-amber-600 dark:text-amber-400',   bar: 'bg-amber-500',   iconBg: 'bg-amber-50 dark:bg-amber-900/25',   iconText: 'text-amber-600 dark:text-amber-400' },
  info:   { text: 'text-blue-600 dark:text-blue-400',     bar: 'bg-blue-500',    iconBg: 'bg-blue-50 dark:bg-blue-900/25',     iconText: 'text-blue-600 dark:text-blue-400' },
  good:   { text: 'text-emerald-600 dark:text-emerald-400', bar: 'bg-emerald-500', iconBg: 'bg-emerald-50 dark:bg-emerald-900/25', iconText: 'text-emerald-600 dark:text-emerald-400' },
  accent: { text: 'text-indigo-600 dark:text-indigo-400', bar: 'bg-indigo-500',  iconBg: 'bg-indigo-50 dark:bg-indigo-900/25', iconText: 'text-indigo-600 dark:text-indigo-400' },
};

// Deterministic avatar colour from a name.
const AV_COLORS = ['#e0794a', '#7c74e8', '#2f9e6b', '#d15b8f', '#3f8fd0', '#c98a2a', '#8a63c9', '#5aa9a0'];
function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AV_COLORS[h % AV_COLORS.length];
}

/** whole-day difference between a YYYY-MM-DD date and today (Bangkok-ish, local) */
function daysAgo(dateStr: string): number {
  const d = new Date(dateStr + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.round((today.getTime() - d.getTime()) / 86400000);
}

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

function Tile({
  tone, label, value, caption, icon: Icon, href,
}: {
  tone: Sev; label: string; value: string; caption?: ReactNode; icon: LucideIcon; href?: string;
}) {
  const c = TONE[tone];
  const body = (
    <div className="group relative flex flex-col gap-1 overflow-hidden rounded-2xl border border-gray-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-gray-700 dark:bg-gray-800">
      <span className={cn('absolute inset-y-0 left-0 w-[3px]', c.bar)} aria-hidden />
      <div className="flex items-center justify-between">
        <span className="text-[0.8rem] font-semibold text-gray-600 dark:text-gray-300">{label}</span>
        <span className={cn('flex h-7 w-7 items-center justify-center rounded-lg', c.iconBg, c.iconText)}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <span className="mt-0.5 text-[1.7rem] font-bold leading-none tracking-tight tabular-nums text-gray-900 dark:text-white">{value}</span>
      {caption && <span className="text-xs text-gray-400 dark:text-gray-500">{caption}</span>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

function CardShell({ title, icon: Icon, action, children, className }: {
  title: string; icon: LucideIcon; action?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <div className={cn('flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800', className)}>
      <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3 dark:border-gray-700/70">
        <h2 className="flex items-center gap-2 text-[0.95rem] font-bold text-gray-900 dark:text-white">
          <Icon className="h-4 w-4 text-gray-400" />{title}
        </h2>
        {action}
      </div>
      {children}
    </div>
  );
}

function Avatar({ name }: { name: string }) {
  const initial = (name || '—').trim().charAt(0) || '—';
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[0.72rem] font-bold text-white"
      style={{ backgroundColor: avatarColor(name) }}>{initial}</span>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CommandCenter({
  stores, expiringDeposits, commissionThisMonth, hrDaily, hrLoaded, tasksCount,
}: CommandCenterProps) {
  const t = useTranslations('overview.cc');
  const locale = useLocale();
  const branches = useMemo(() => stores.filter((s) => !s.isCentral), [stores]);

  // ---- aggregates for the "today" strip + action queue ----
  const agg = useMemo(() => {
    const sum = (f: (s: CcStoreStatus) => number) => stores.reduce((a, s) => a + f(s), 0);
    const explanations = sum((s) => s.pendingExplanations);
    const approvals = sum((s) => s.pendingApprovals);
    const withdrawals = sum((s) => s.pendingWithdrawals);
    const barConfirm = sum((s) => s.pendingConfirm);
    const transfers = sum((s) => s.pendingTransfers + s.pendingIncomingTransfers);
    const borrows = sum((s) => s.borrowsToApprove + s.lendsToApprove);
    const depositReq = sum((s) => s.pendingDeposits);
    const actionTotal = explanations + approvals + withdrawals + barConfirm + transfers + borrows + depositReq;
    const staleStores = branches.filter((s) => !s.lastStockCheck || daysAgo(s.lastStockCheck) >= 1).length;
    return { explanations, approvals, withdrawals, barConfirm, transfers, borrows, actionTotal, staleStores };
  }, [stores, branches]);

  // Global counts drive the "today" tiles (all branches).
  const onLeaveAll = hrDaily?.on_leave ?? [];
  const notInAll = hrDaily?.not_in ?? [];
  const headcount = hrDaily?.headcount ?? 0;

  // The team card can be filtered by branch.
  const teamStores = hrDaily?.stores ?? [];
  const [teamBranch, setTeamBranch] = useState<string>('all');
  const inBranch = (p: HrPerson) => teamBranch === 'all' || (p.store_ids ?? []).includes(teamBranch);
  const checkedInList = (hrDaily?.checked_in ?? []).filter(inBranch);
  const onLeaveList = onLeaveAll.filter(inBranch);
  const notInList = notInAll.filter(inBranch);
  const teamTotal = checkedInList.length + onLeaveList.length + notInList.length;
  const inPct = teamTotal ? (checkedInList.length / teamTotal) * 100 : 0;
  const lvPct = teamTotal ? (onLeaveList.length / teamTotal) * 100 : 0;
  const noPct = teamTotal ? (notInList.length / teamTotal) * 100 : 0;

  const leaveLabel = (p: HrLeavePerson): string | null =>
    (locale.startsWith('th') ? p.leave_th : p.leave_en) || p.leave_th || p.leave_en || null;

  // "View all" → the HR daily dashboard, pre-filtered to the selected branch (or all branches).
  const hrHref = teamBranch === 'all' ? '/hr/dashboard' : `/hr/dashboard?store_id=${encodeURIComponent(teamBranch)}`;

  const queue = ([
    { key: 'expl', tone: 'crit', label: t('q.explanations'), sub: t('q.explanationsSub'), count: agg.explanations, href: '/stock/comparison', icon: AlertTriangle },
    { key: 'appr', tone: 'warn', label: t('q.approvals'), sub: t('q.approvalsSub'), count: agg.approvals, href: '/stock/approval', icon: FileWarning },
    { key: 'wd', tone: 'warn', label: t('q.withdrawals'), sub: t('q.withdrawalsSub'), count: agg.withdrawals, href: '/deposit/withdrawals', icon: ClipboardCheck },
    { key: 'bar', tone: 'warn', label: t('q.barConfirm'), sub: t('q.barConfirmSub'), count: agg.barConfirm, href: '/bar-approval', icon: CheckCircle2 },
    { key: 'tr', tone: 'info', label: t('q.transfers'), sub: t('q.transfersSub'), count: agg.transfers, href: '/transfer', icon: ArrowRightLeft },
    { key: 'bw', tone: 'info', label: t('q.borrows'), sub: t('q.borrowsSub'), count: agg.borrows, href: '/borrow', icon: Repeat },
  ] as Array<{ key: string; tone: Sev; label: string; sub: string; count: number; href: string; icon: LucideIcon }>)
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);

  return (
    <div className="space-y-4">
      {/* ---- Today strip ---- */}
      <div>
        <div className="mb-2.5 flex items-center gap-2 px-0.5 text-[0.72rem] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">
          <span className="inline-block h-[7px] w-[7px] rounded-full bg-red-500 ring-4 ring-red-500/15" />
          {t('todayHeading')}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          <Tile tone="crit" icon={ClipboardCheck} label={t('tiles.action')} value={formatNumber(agg.actionTotal)} caption={t('tiles.actionCap')} href="/inbox" />
          <Tile tone="warn" icon={UserMinus} label={t('tiles.notIn')}
            value={hrLoaded ? formatNumber(notInAll.length) : '—'}
            caption={hrLoaded ? t('tiles.notInCap', { total: headcount }) : t('tiles.hrOff')} />
          <Tile tone="info" icon={CalendarClock} label={t('tiles.onLeave')}
            value={hrLoaded ? formatNumber(onLeaveAll.length) : '—'}
            caption={hrLoaded ? t('tiles.onLeaveCap') : t('tiles.hrOff')} />
          <Tile tone="warn" icon={ClipboardCheck} label={t('tiles.stale')}
            value={`${formatNumber(agg.staleStores)}/${formatNumber(branches.length)}`}
            caption={t('tiles.staleCap')} href="/stock" />
          <Tile tone="crit" icon={AlertTriangle} label={t('tiles.expiring')} value={formatNumber(expiringDeposits)} caption={t('tiles.expiringCap')} href="/deposit" />
          <Tile tone="good" icon={Coins} label={t('tiles.commission')} value={`฿${formatNumber(Math.round(commissionThisMonth))}`} caption={t('tiles.commissionCap')} href="/commission" />
        </div>
      </div>

      {/* ---- Bento: team + queue ---- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.5fr_1fr]">
        {/* Team today */}
        <CardShell title={t('team.title')} icon={Users}
          action={<Link href="/hr/dashboard" className="text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400">{t('team.link')} →</Link>}>
          <div className="p-4">
            {!hrLoaded ? (
              <p className="py-6 text-center text-sm text-gray-400">{t('team.noAccess')}</p>
            ) : headcount === 0 ? (
              <p className="py-6 text-center text-sm text-gray-400">{t('team.noStaff')}</p>
            ) : (
              <>
                {teamStores.length > 1 && (
                  <div className="-mt-1 mb-3 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    <BranchTab active={teamBranch === 'all'} onClick={() => setTeamBranch('all')} label={t('team.allBranches')} />
                    {teamStores.map((s) => (
                      <BranchTab key={s.id} active={teamBranch === s.id} onClick={() => setTeamBranch(s.id)} label={s.name} />
                    ))}
                  </div>
                )}
                <div className="flex h-3 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
                  <span className="bg-emerald-500" style={{ width: `${inPct}%` }} />
                  <span className="bg-blue-500" style={{ width: `${lvPct}%` }} />
                  <span className="bg-amber-500" style={{ width: `${noPct}%` }} />
                </div>
                <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-600 dark:text-gray-300">
                  <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />{t('team.in')} <b className="font-bold text-gray-900 dark:text-white">{checkedInList.length}</b></span>
                  <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-blue-500" />{t('team.leave')} <b className="font-bold text-gray-900 dark:text-white">{onLeaveList.length}</b></span>
                  <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-amber-500" />{t('team.notin')} <b className="font-bold text-gray-900 dark:text-white">{notInList.length}</b></span>
                  <span className="ml-auto text-xs text-gray-400">{t('team.total', { count: teamTotal })}</span>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <PeopleCol tone="info" title={t('team.onLeaveTitle')} people={onLeaveList} empty={t('team.noneLeave')} chip={leaveLabel} href={hrHref} viewAllLabel={t('team.viewAll')} />
                  <PeopleCol tone="warn" title={t('team.notInTitle')} people={notInList} empty={t('team.noneNotIn')} href={hrHref} viewAllLabel={t('team.viewAll')} />
                </div>
              </>
            )}
          </div>
        </CardShell>

        {/* Action queue */}
        <CardShell title={t('queue.title')} icon={ListTodo}
          action={<span className="text-xs font-semibold text-gray-400">{t('queue.total', { count: agg.actionTotal })}</span>}>
          <div className="px-2 py-1">
            {queue.length === 0 ? (
              <p className="py-8 text-center text-sm text-gray-400">{t('queue.empty')}</p>
            ) : queue.map((r) => {
              const c = TONE[r.tone];
              const Icon = r.icon;
              return (
                <Link key={r.key} href={r.href}
                  className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/40">
                  <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', c.iconBg, c.iconText)}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-gray-900 dark:text-white">{r.label}</span>
                    <span className="block truncate text-xs text-gray-400">{r.sub}</span>
                  </span>
                  <span className={cn('text-lg font-bold tabular-nums', c.text)}>{formatNumber(r.count)}</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-gray-300 dark:text-gray-600" />
                </Link>
              );
            })}
            {tasksCount != null && tasksCount > 0 && (
              <Link href="/tasks" className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/40">
                <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', TONE.accent.iconBg, TONE.accent.iconText)}>
                  <ListTodo className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-gray-900 dark:text-white">{t('queue.tasks')}</span>
                  <span className="block truncate text-xs text-gray-400">{t('queue.tasksSub')}</span>
                </span>
                <span className={cn('text-lg font-bold tabular-nums', TONE.accent.text)}>{formatNumber(tasksCount)}</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-gray-300 dark:text-gray-600" />
              </Link>
            )}
          </div>
        </CardShell>
      </div>

      {/* ---- Branch health matrix ---- */}
      <CardShell title={t('matrix.title')} icon={Banknote}
        action={<Link href="/reports" className="text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400">{t('matrix.link')} →</Link>}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="text-[0.7rem] uppercase tracking-wide text-gray-400 dark:text-gray-500">
                <th className="sticky left-0 z-10 bg-white px-4 py-2.5 text-left font-bold dark:bg-gray-800">{t('matrix.branch')}</th>
                <th className="px-3 py-2.5 text-left font-bold">{t('matrix.lastCheck')}</th>
                <th className="px-3 py-2.5 text-right font-bold">{t('matrix.newDeposits')}</th>
                <th className="px-3 py-2.5 text-right font-bold">{t('matrix.active')}</th>
                <th className="px-3 py-2.5 text-right font-bold">{t('matrix.expiring')}</th>
                <th className="px-3 py-2.5 text-right font-bold">{t('matrix.commission')}</th>
                <th className="px-3 py-2.5 text-right font-bold">{t('matrix.issues')}</th>
              </tr>
            </thead>
            <tbody>
              {stores.map((s) => {
                const issues =
                  s.pendingExplanations + s.pendingApprovals + s.pendingWithdrawals +
                  s.pendingConfirm + s.pendingTransfers + s.pendingIncomingTransfers +
                  s.borrowsToApprove + s.lendsToApprove + s.pendingDeposits;
                const d = s.lastStockCheck ? daysAgo(s.lastStockCheck) : null;
                let fresh: { cls: string; label: string };
                if (s.isCentral || d === null) fresh = { cls: 'text-gray-400', label: '—' };
                else if (d <= 0) fresh = { cls: 'text-emerald-600 dark:text-emerald-400', label: t('matrix.today') };
                else if (d === 1) fresh = { cls: 'text-amber-600 dark:text-amber-400', label: t('matrix.yesterday') };
                else fresh = { cls: 'text-red-600 dark:text-red-400', label: t('matrix.daysAgo', { count: d }) };
                return (
                  <tr key={s.id} className="border-t border-gray-100 hover:bg-gray-50/60 dark:border-gray-700/70 dark:hover:bg-gray-700/25">
                    <td className="sticky left-0 z-10 bg-white px-4 py-2.5 text-left font-semibold text-gray-900 dark:bg-gray-800 dark:text-white">
                      {s.name}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={cn('inline-flex items-center gap-1.5 font-semibold', fresh.cls)}>
                        <i className="h-2 w-2 rounded-full bg-current" />{fresh.label}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-gray-700 dark:text-gray-300">{formatNumber(s.depositsThisMonth)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-gray-700 dark:text-gray-300">{formatNumber(s.activeDeposits)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {s.expiringDeposits > 0
                        ? <span className="rounded-md bg-red-50 px-2 py-0.5 font-bold text-red-600 dark:bg-red-900/25 dark:text-red-400">{formatNumber(s.expiringDeposits)}</span>
                        : <span className="text-gray-400">0</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-gray-700 dark:text-gray-300">
                      {s.commissionThisMonth > 0 ? `฿${formatNumber(Math.round(s.commissionThisMonth))}` : <span className="text-gray-400">฿0</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {issues > 0
                        ? <span className="font-bold text-amber-600 dark:text-amber-400">{formatNumber(issues)}</span>
                        : <span className="text-gray-400">0</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardShell>
    </div>
  );
}

function BranchTab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick}
      className={cn('shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold transition-colors',
        active
          ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
          : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700/50')}>
      {label}
    </button>
  );
}

function PeopleCol({ tone, title, people, empty, chip, href, viewAllLabel }: {
  tone: Sev; title: string; people: HrLeavePerson[]; empty: string;
  chip?: (p: HrLeavePerson) => string | null; href?: string; viewAllLabel?: string;
}) {
  const c = TONE[tone];
  const shown = people.slice(0, 5);
  const rest = people.length - shown.length;
  const clickable = Boolean(href) && people.length > 0;
  const body = (
    <>
      <div className="mb-2.5 flex items-center justify-between">
        <span className="inline-flex items-center gap-2 text-[0.82rem] font-bold text-gray-700 dark:text-gray-200">
          <i className={cn('h-2 w-2 rounded-full', c.bar)} />{title}
        </span>
        <span className={cn('text-[0.95rem] font-bold tabular-nums', c.text)}>{people.length}</span>
      </div>
      {people.length === 0 ? (
        <p className="flex items-center gap-1.5 py-1 text-xs text-gray-400"><UserCheck className="h-3.5 w-3.5" />{empty}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {shown.map((p) => {
            const label = chip?.(p);
            return (
              <div key={p.user_id} className="flex items-center gap-2.5">
                <Avatar name={p.name} />
                <span className="min-w-0 flex-1 truncate text-[0.86rem] font-medium text-gray-800 dark:text-gray-200">{p.name}</span>
                {label && (
                  <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[0.68rem] font-bold text-blue-600 dark:bg-blue-900/25 dark:text-blue-400">{label}</span>
                )}
              </div>
            );
          })}
          {rest > 0 && <span className="pt-0.5 text-xs text-gray-400">+ {rest}</span>}
        </div>
      )}
      {clickable && viewAllLabel && (
        <span className="mt-2.5 flex items-center gap-0.5 border-t border-gray-200/70 pt-2 text-xs font-semibold text-indigo-600 dark:border-gray-700/60 dark:text-indigo-400">
          {viewAllLabel}<ChevronRight className="h-3.5 w-3.5" />
        </span>
      )}
    </>
  );
  const cls = cn('rounded-xl border bg-gray-50/60 p-3 dark:bg-gray-900/20',
    tone === 'info' ? 'border-blue-200/70 dark:border-blue-900/50' : 'border-amber-200/70 dark:border-amber-900/50',
    clickable && 'group transition-colors hover:border-indigo-300 hover:bg-gray-100/80 dark:hover:border-indigo-700/60 dark:hover:bg-gray-900/40');
  return clickable && href ? (
    <Link href={href} className={cn('block', cls)}>{body}</Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
