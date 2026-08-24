'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Loader2, CalendarPlus, LayoutGrid, List, Table, Search } from 'lucide-react';
import { PageHeader, SectionHeading, Button, toast } from '@/components/ui';
import { openBusinessDateBangkok } from '@/lib/utils/date';
import { cn } from '@/lib/utils/cn';
import { BulkBackfillModal } from './_components/bulk-backfill-modal';
import { DayTable, SummaryChips, isEmptyDay } from '@/components/hr/timesheet-parts';
import {
  TimesheetBlockGrid,
  TimesheetSummaryTable,
  nickTitle,
  type TimesheetEmployee,
} from './_components/timesheet-views';
import { TimesheetEditModal, type EditTarget, type LeaveTypeOption } from './_components/timesheet-edit-modal';
import { PayWindowBar, shiftMonth } from './_components/pay-window-bar';
import { EmployeePeriodSummary } from './_components/employee-period-summary';
import { AttendanceScoreCard } from '@/components/hr/attendance-score-card';
import { PayrollScopeChips, dominantCompany } from '@/components/hr/payroll-scope-chips';
import { payMonthOf, payWindows, type PayWindow } from '@/lib/hr/pay-cycle';
import type { ScoreConfig } from '@/lib/hr/attendance-score';

interface StoreOpt {
  id: string;
  store_code: string;
  store_name: string;
}
type Employee = TimesheetEmployee;

type ViewMode = 'blocks' | 'full' | 'summary';

const MAX_RANGE_DAYS = 62;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** store filter value for "employees attached to no venue" — mirrors NO_STORE in the API route. */
const NO_STORE = 'none';

function dayDiff(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

/**
 * The salary window of a payroll month — the 26th→25th cycle, so the sheet opens on the cycle HR is
 * working on rather than a rolling slice. Read from payWindows so this page and the slip cannot
 * drift on where a cycle starts; the same helper supplies the two SV windows beside it.
 */
function salaryRange(payMonth: string): { from: string; to: string } {
  const w = payWindows(payMonth)[0];
  return { from: w.from, to: w.to };
}

export default function HrTimesheetPage() {
  const t = useTranslations('hr.timesheet');
  const isTh = useLocale() === 'th';
  const L = isTh
    ? {
        blocks: 'บล็อก', full: 'แบบเต็ม', summary: 'สรุป', search: 'ค้นหาชื่อ/พนักงาน',
        noMatch: 'ไม่พบพนักงานที่ค้นหา', byStore: 'สาขา', byCompany: 'บริษัท',
        noCompany: '— ไม่ระบุบริษัท —', showAlso: 'แสดงด้วย', hideAgain: 'ซ่อนอีกครั้ง',
      }
    : {
        blocks: 'Blocks', full: 'Full', summary: 'Summary', search: 'Search name',
        noMatch: 'No matching employee', byStore: 'Venue', byCompany: 'Company',
        noCompany: '— No company —', showAlso: 'Show them too', hideAgain: 'Hide again',
      };

  const initialPayMonth = useMemo(() => payMonthOf(openBusinessDateBangkok()), []);
  const initialRange = useMemo(() => salaryRange(initialPayMonth), [initialPayMonth]);

  const [stores, setStores] = useState<StoreOpt[]>([]);
  const [storeId, setStoreId] = useState('');
  // Read the sheet by venue (the original) or by COMPANY. Payroll is generated per company, so the
  // company axis is the one on which this page and the payrun list the same people — which is what
  // HR had been reconciling by hand (owner ask 2026-08-17).
  const [scopeKind, setScopeKind] = useState<'store' | 'company'>('store');
  const [companyId, setCompanyId] = useState('');
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
  // Venue members with no roster row and no punch here this window — held out of the grid by the
  // API, listed here so they are offered back rather than silently missing.
  const [inactiveHere, setInactiveHere] = useState<{ user_id: string; name: string }[]>([]);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [from, setFrom] = useState<string>(initialRange.from);
  const [to, setTo] = useState<string>(initialRange.to);
  // The payroll month the window chips are derived from. Held separately from from/to because the
  // SV windows sit in the month BEFORE the one they pay in — deriving the anchor back out of the
  // dates would make picking "SV 15/08" re-anchor the bar onto July and rename every chip.
  const [payMonth, setPayMonth] = useState<string>(initialPayMonth);
  const [summaryOf, setSummaryOf] = useState<string | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveTypeOption[]>([]);
  const [scoreConfig, setScoreConfig] = useState<ScoreConfig | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [view, setView] = useState<ViewMode>('blocks');
  const [search, setSearch] = useState('');

  // Deep-link support so the payroll slip can send HR straight here to fix a person's OT
  // (?store=&from=&to=&q=). Read off window.location rather than useSearchParams so the page
  // needs no Suspense boundary. Runs once; the store effect below preserves a seeded store.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const qFrom = p.get('from');
    const qTo = p.get('to');
    const qStore = p.get('store');
    const qSearch = p.get('q');
    if (qFrom && DATE_RE.test(qFrom)) setFrom(qFrom);
    if (qTo && DATE_RE.test(qTo)) {
      setTo(qTo);
      // Follow the deep link's month, so a slip that sends HR here lands with the chips describing
      // the payroll month it came from rather than whatever month today happens to be in.
      setPayMonth(payMonthOf(qTo));
    }
    if (qStore) setStoreId(qStore);
    if (qSearch) setSearch(qSearch);
  }, []);

  // manageable stores → default to first
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/hr/manageable-stores');
        const json = await res.json();
        const list = (json.data ?? []) as StoreOpt[];
        setStores(list);
        setStoreId((prev) => prev || list[0]?.id || '');
      } catch {
        setStores([]);
      }
    })();
  }, []);

  // NO_STORE is a filter sentinel, not a real store id — never let it reach an API that expects a
  // uuid (the override write, the bulk grid). Those fall back to "no explicit store", as does
  // company scope, where the rows on screen span venues and no single store id is meaningful.
  const noStore = storeId === NO_STORE;
  const realStoreId = noStore || scopeKind === 'company' ? '' : storeId;

  const scopeQS =
    scopeKind === 'company'
      ? `company_id=${encodeURIComponent(companyId)}`
      : `store_id=${encodeURIComponent(storeId)}`;
  const scopeReady = scopeKind === 'company' ? !!companyId : !!storeId;

  const load = useCallback(async () => {
    if (!scopeReady) {
      setEmployees([]);
      setInactiveHere([]);
      setLoading(false);
      return;
    }
    if (from > to || dayDiff(from, to) > MAX_RANGE_DAYS) {
      toast({ type: 'warning', title: t('rangeTooLong') });
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `/api/hr/timesheet?${scopeQS}&from=${from}&to=${to}${includeInactive ? '&include_inactive=true' : ''}`
      );
      if (!res.ok) throw new Error('load failed');
      const j = await res.json();
      setEmployees((j.employees ?? []) as Employee[]);
      setLeaveTypes((j.leave_types ?? []) as LeaveTypeOption[]);
      setInactiveHere((j.inactive_here ?? []) as { user_id: string; name: string }[]);
      setCompanies((j.companies ?? []) as { id: string; name: string }[]);
      if (j.score_config) setScoreConfig(j.score_config as ScoreConfig);
    } catch {
      toast({ type: 'error', title: t('loadFailed') });
      setEmployees([]);
      setInactiveHere([]);
    } finally {
      setLoading(false);
    }
  }, [scopeReady, scopeQS, from, to, includeInactive, t]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter((e) => e.name.toLowerCase().includes(q));
  }, [employees, search]);

  // A venue's timesheet lists its store members; a payrun is generated per company + payroll
  // group. Where those disagree, say so on the rows — HR was reading the difference as missing
  // data (owner report 2026-08-17). Derived from the WHOLE list, so searching can't change it.
  const homeCompany = useMemo(() => dominantCompany(employees), [employees]);
  const visitingCount = useMemo(
    () => employees.filter((e) => e.company_name && e.company_name !== homeCompany).length,
    [employees, homeCompany]
  );
  const groupedNames = useMemo(
    () => [...new Set(employees.map((e) => e.payroll_group_name).filter(Boolean))] as string[],
    [employees]
  );

  const views: { key: ViewMode; label: string; icon: typeof LayoutGrid }[] = [
    { key: 'blocks', label: L.blocks, icon: LayoutGrid },
    { key: 'full', label: L.full, icon: List },
    { key: 'summary', label: L.summary, icon: Table },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <>
            <label className="flex flex-col text-xs font-medium text-gray-600 dark:text-gray-400">
              {/* Venue ↔ company, matching the roster's switch. The company axis is payroll's axis. */}
              <span className="inline-flex rounded-md bg-gray-100 p-0.5 dark:bg-gray-700">
                {([
                  { kind: 'store', label: L.byStore },
                  { kind: 'company', label: L.byCompany },
                ] as const).map(({ kind, label }) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => {
                      setScopeKind(kind);
                      if (kind === 'company' && !companyId) setCompanyId(companies[0]?.id ?? 'none');
                    }}
                    className={cn(
                      'rounded px-2 py-0.5 text-[11px] font-medium transition-colors',
                      scopeKind === kind
                        ? 'bg-white text-indigo-600 shadow-sm dark:bg-gray-800 dark:text-indigo-300'
                        : 'text-gray-500 dark:text-gray-400'
                    )}
                  >
                    {label}
                  </button>
                ))}
              </span>
              {scopeKind === 'store' ? (
                <select value={storeId} onChange={(e) => setStoreId(e.target.value)} className="control mt-1">
                  {stores.length === 0 && <option value="">{t('noStores')}</option>}
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.store_name}
                    </option>
                  ))}
                  {/* Office staff (HR, accounting, graphic) belong to a company but no venue, so a
                      store-keyed roster never listed them and their hours could not be back-filled. */}
                  <option value={NO_STORE}>{isTh ? '— ไม่สังกัดสาขา —' : '— No venue —'}</option>
                </select>
              ) : (
                <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} className="control mt-1">
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                  <option value="none">{L.noCompany}</option>
                </select>
              )}
            </label>
            <label className="flex flex-col text-xs font-medium text-gray-600 dark:text-gray-400">
              {t('filterFrom')}
              <input
                type="date"
                value={from}
                max={to}
                onChange={(e) => setFrom(e.target.value)}
                className="control mt-1"
              />
            </label>
            <label className="flex flex-col text-xs font-medium text-gray-600 dark:text-gray-400">
              {t('filterTo')}
              <input
                type="date"
                value={to}
                min={from}
                onChange={(e) => setTo(e.target.value)}
                className="control mt-1"
              />
            </label>
            <div className="flex items-end">
              {/* Bulk backfill seeds its grid from a store roster — meaningless without one venue. */}
              <Button
                variant="outline"
                onClick={() => setBulkOpen(true)}
                disabled={!storeId || noStore || scopeKind === 'company'}
              >
                <CalendarPlus className="h-4 w-4" />
                {t('bulkBackfill')}
              </Button>
            </div>
          </>
        }
      />

      {/* Secondary toolbar: search + view switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={L.search}
            className="control control-icon w-full"
          />
        </div>
        <div className="inline-flex items-center gap-0.5 rounded-lg bg-gray-100 p-0.5 dark:bg-gray-800">
          {views.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setView(key)}
              aria-pressed={view === key}
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors',
                view === key
                  ? 'bg-white text-indigo-600 shadow-sm dark:bg-gray-700 dark:text-indigo-300'
                  : 'text-gray-500 dark:text-gray-400'
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Which payroll figure the range on screen is the one behind — and one tap to the others. */}
      <PayWindowBar
        payMonth={payMonth}
        from={from}
        to={to}
        onPick={(w) => {
          setFrom(w.from);
          setTo(w.to);
        }}
        onShiftMonth={(by) => {
          const next = shiftMonth(payMonth, by);
          setPayMonth(next);
          // Carry the reading across: someone stepping months while looking at an SV window wants
          // the next month's SV window, not to be dropped back onto the salary cycle.
          const from0 = payWindows(payMonth).find((w) => w.from === from && w.to === to);
          const moved = payWindows(next).find((w) => w.key === (from0?.key ?? 'salary'));
          if (moved) {
            setFrom(moved.from);
            setTo(moved.to);
          }
        }}
      />

      {/* Members held out of the grid: attached to this venue but with no roster row and no punch
          here this window. They are almost always people who OVERSEE the venue rather than work it —
          user_stores cannot tell the two apart — so they are offered rather than shown. */}
      {!loading && inactiveHere.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-gray-200 bg-gray-50/70 px-3 py-2 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-800/40 dark:text-gray-400">
          <span className="font-medium">
            {isTh
              ? `อีก ${inactiveHere.length} คนถูกผูกกับสาขานี้ แต่ไม่มีตารางกะและไม่มีการลงเวลาที่นี่เลยใน 3 เดือนที่ผ่านมา`
              : `${inactiveHere.length} more are attached to this venue but have had no roster row and no punch here in the past 3 months`}
          </span>
          <span className="opacity-80">{inactiveHere.map((p) => p.name).join(' · ')}</span>
          <button
            type="button"
            onClick={() => setIncludeInactive((v) => !v)}
            className="ml-auto shrink-0 font-medium text-indigo-600 hover:underline dark:text-indigo-400"
          >
            {includeInactive ? L.hideAgain : L.showAlso}
          </button>
        </div>
      )}

      {/* Why this list and the payrun's list differ — stated once, then chipped per row. */}
      {!loading && (visitingCount > 0 || groupedNames.length > 0) && (
        <p className="rounded-xl border border-gray-200 bg-gray-50/70 px-3 py-2 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-800/40 dark:text-gray-400">
          {scopeKind === 'company'
            ? isTh
              ? 'มุมมองนี้ยึดตามบริษัท ตรงกับแกนที่เงินเดือนใช้ออก payrun — แต่ยังแยกตาม “กลุ่มเงินเดือน” อีกชั้น คนที่มีป้ายกลุ่มจะอยู่ใน payrun คนละใบ'
              : 'This view is keyed on company, the same axis payroll generates on — but a company is still split by payroll group, so chipped rows sit on a separate payrun.'
            : isTh
              ? 'มุมมองนี้ยึดตามสาขา ส่วนเงินเดือนออกเป็นราย “บริษัท” และแยกตาม “กลุ่มเงินเดือน” — คนที่มีป้ายกำกับท้ายชื่อจะไปอยู่ใน payrun คนละใบกับสาขานี้ (กดปุ่ม “บริษัท” ด้านบนเพื่อดูบนแกนเดียวกับเงินเดือน)'
              : 'This view is keyed on venue; a payrun is generated per company and split by payroll group — the chipped rows are paid on a different payrun than this venue’s. Switch to “Company” above to read it on payroll’s axis.'}
        </p>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-10 text-gray-400">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : stores.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-400 dark:border-gray-700">
          {t('noStores')}
        </p>
      ) : employees.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-400 dark:border-gray-700">
          {t('noEmployees')}
        </p>
      ) : filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-400 dark:border-gray-700">
          {L.noMatch}
        </p>
      ) : view === 'blocks' ? (
        <TimesheetBlockGrid
          employees={filtered}
          homeCompany={homeCompany}
          onPick={(emp, day) => setEditTarget({ userId: emp.user_id, name: emp.name, companyId: emp.company_id, otEligible: emp.ot_eligible, payType: emp.pay_type, day })}
          onPickEmployee={(emp) => setSummaryOf(emp.user_id)}
        />
      ) : view === 'summary' ? (
        <TimesheetSummaryTable
          employees={filtered}
          homeCompany={homeCompany}
          onPick={(emp) => setSummaryOf(emp.user_id)}
        />
      ) : (
        <div className="space-y-6">
          {filtered.map((emp) => {
            const hasData = emp.days.some((d) => !isEmptyDay(d));
            return (
              <section key={emp.user_id} className="space-y-2">
                <div className="flex flex-wrap items-center" title={nickTitle(emp, isTh)}>
                  <SectionHeading title={emp.end_date ? `${emp.name} · ${t('departed')}` : emp.name} />
                  <PayrollScopeChips emp={emp} homeCompany={homeCompany} isTh={isTh} />
                </div>
                <AttendanceScoreCard days={emp.days} today={openBusinessDateBangkok()} compact config={scoreConfig} />
                <SummaryChips totals={emp.totals} />
                {hasData ? (
                  <DayTable
                    days={emp.days}
                    onEditDay={(day) => setEditTarget({ userId: emp.user_id, name: emp.name, companyId: emp.company_id, otEligible: emp.ot_eligible, payType: emp.pay_type, day })}
                  />
                ) : (
                  <p className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-400 dark:border-gray-700">
                    {t('noData')}
                  </p>
                )}
              </section>
            );
          })}
        </div>
      )}

      {(() => {
        const emp = summaryOf ? employees.find((e) => e.user_id === summaryOf) : null;
        if (!emp) return null;
        return (
          <EmployeePeriodSummary
            emp={emp}
            from={from}
            to={to}
            payMonth={payMonth}
            onClose={() => setSummaryOf(null)}
            onPickWindow={(w: PayWindow) => {
              setFrom(w.from);
              setTo(w.to);
              // Stay open: the whole point is comparing the same person across the two windows,
              // and reopening the card by hand after every switch defeats that.
            }}
            onViewDays={() => {
              setSummaryOf(null);
              setSearch(emp.name);
              setView('full');
            }}
          />
        );
      })()}

      <TimesheetEditModal
        isOpen={!!editTarget}
        target={editTarget}
        storeId={realStoreId}
        leaveTypes={leaveTypes}
        onClose={() => setEditTarget(null)}
        onSaved={() => {
          setEditTarget(null);
          load();
        }}
      />

      <BulkBackfillModal
        isOpen={bulkOpen}
        storeId={realStoreId}
        storeName={stores.find((s) => s.id === storeId)?.store_name ?? ''}
        defaultFrom={from}
        defaultTo={to}
        onClose={() => setBulkOpen(false)}
        onDone={() => {
          setBulkOpen(false);
          load();
        }}
      />
    </div>
  );
}
