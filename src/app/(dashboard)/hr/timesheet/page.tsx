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
  type TimesheetEmployee,
} from './_components/timesheet-views';
import { TimesheetEditModal, type EditTarget, type LeaveTypeOption } from './_components/timesheet-edit-modal';
import { AttendanceScoreCard } from '@/components/hr/attendance-score-card';
import { PayrollScopeChips, dominantCompany } from '@/components/hr/payroll-scope-chips';
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

// The active payroll month runs 26th → 25th (§ pay cycle). Given today, return that window so the
// timesheet defaults to the cycle HR is actually working on rather than a rolling 7-day slice.
function payCycleRange(today: string): { from: string; to: string } {
  const [y, m, d] = today.split('-').map(Number);
  const startMs = d >= 26 ? Date.UTC(y, m - 1, 26) : Date.UTC(y, m - 2, 26);
  const endMs = d >= 26 ? Date.UTC(y, m, 25) : Date.UTC(y, m - 1, 25);
  return { from: new Date(startMs).toISOString().slice(0, 10), to: new Date(endMs).toISOString().slice(0, 10) };
}

export default function HrTimesheetPage() {
  const t = useTranslations('hr.timesheet');
  const isTh = useLocale() === 'th';
  const L = isTh
    ? { blocks: 'บล็อก', full: 'แบบเต็ม', summary: 'สรุป', search: 'ค้นหาชื่อ/พนักงาน', noMatch: 'ไม่พบพนักงานที่ค้นหา' }
    : { blocks: 'Blocks', full: 'Full', summary: 'Summary', search: 'Search name', noMatch: 'No matching employee' };

  const initialRange = useMemo(() => payCycleRange(openBusinessDateBangkok()), []);

  const [stores, setStores] = useState<StoreOpt[]>([]);
  const [storeId, setStoreId] = useState('');
  const [from, setFrom] = useState<string>(initialRange.from);
  const [to, setTo] = useState<string>(initialRange.to);
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
    if (qTo && DATE_RE.test(qTo)) setTo(qTo);
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
  // uuid (the override write, the bulk grid). Those fall back to "no explicit store".
  const noStore = storeId === NO_STORE;
  const realStoreId = noStore ? '' : storeId;

  const load = useCallback(async () => {
    if (!storeId) {
      setEmployees([]);
      setLoading(false);
      return;
    }
    if (from > to || dayDiff(from, to) > MAX_RANGE_DAYS) {
      toast({ type: 'warning', title: t('rangeTooLong') });
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/hr/timesheet?store_id=${storeId}&from=${from}&to=${to}`);
      if (!res.ok) throw new Error('load failed');
      const j = await res.json();
      setEmployees((j.employees ?? []) as Employee[]);
      setLeaveTypes((j.leave_types ?? []) as LeaveTypeOption[]);
      if (j.score_config) setScoreConfig(j.score_config as ScoreConfig);
    } catch {
      toast({ type: 'error', title: t('loadFailed') });
      setEmployees([]);
    } finally {
      setLoading(false);
    }
  }, [storeId, from, to, t]);

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
              {t('filterStore')}
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
              {/* Bulk backfill seeds its grid from a store roster — meaningless without a venue. */}
              <Button variant="outline" onClick={() => setBulkOpen(true)} disabled={!storeId || noStore}>
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

      {/* Why this list and the payrun's list differ — stated once, then chipped per row. */}
      {!loading && (visitingCount > 0 || groupedNames.length > 0) && (
        <p className="rounded-xl border border-gray-200 bg-gray-50/70 px-3 py-2 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-800/40 dark:text-gray-400">
          {isTh
            ? 'รายชื่อหน้านี้ยึดตามสาขาที่พนักงานสังกัด ส่วนเงินเดือนออกเป็นราย “บริษัท” และแยกตาม “กลุ่มเงินเดือน” — คนที่มีป้ายกำกับท้ายชื่อจะไปอยู่ใน payrun คนละใบกับสาขานี้'
            : 'This list is keyed on venue membership; a payrun is generated per company and split by payroll group — the chipped rows are paid on a different payrun than this venue’s.'}
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
          onPick={(emp, day) => setEditTarget({ userId: emp.user_id, name: emp.name, companyId: emp.company_id, otEligible: emp.ot_eligible, day })}
        />
      ) : view === 'summary' ? (
        <TimesheetSummaryTable
          employees={filtered}
          homeCompany={homeCompany}
          onPick={(emp) => {
            setSearch(emp.name);
            setView('full');
          }}
        />
      ) : (
        <div className="space-y-6">
          {filtered.map((emp) => {
            const hasData = emp.days.some((d) => !isEmptyDay(d));
            return (
              <section key={emp.user_id} className="space-y-2">
                <div className="flex flex-wrap items-center">
                  <SectionHeading title={emp.end_date ? `${emp.name} · ${t('departed')}` : emp.name} />
                  <PayrollScopeChips emp={emp} homeCompany={homeCompany} isTh={isTh} />
                </div>
                <AttendanceScoreCard days={emp.days} today={openBusinessDateBangkok()} compact config={scoreConfig} />
                <SummaryChips totals={emp.totals} />
                {hasData ? (
                  <DayTable
                    days={emp.days}
                    onEditDay={(day) => setEditTarget({ userId: emp.user_id, name: emp.name, companyId: emp.company_id, otEligible: emp.ot_eligible, day })}
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
