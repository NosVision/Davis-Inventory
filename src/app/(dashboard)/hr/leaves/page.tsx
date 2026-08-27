'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Inbox, FileText, CalendarRange, ListChecks, Search } from 'lucide-react';
import { Button, Select, PageHeader, ViewToggle, useViewMode, DataList, DataCard, StatusBadge, SkeletonList, toast, usePromptDialog } from '@/components/ui';
import { matchesEmployeeSearch } from '@/lib/hr/employee-name';
import { formatThaiDate } from '@/lib/utils/format';
import { EmployeeName } from '@/components/hr/employee-name';
import Link from 'next/link';

interface StoreOpt {
  id: string;
  store_code: string;
  store_name: string;
}
type Status = 'pending' | 'approved' | 'rejected' | 'cancelled';

interface LeaveRow {
  id: string;
  leave_type_id: string;
  from_date: string;
  to_date: string;
  days: number;
  reason: string;
  cert_path: string | null;
  status: Status;
  decision_note: string | null;
  /** null = the employee has no venue (company-level / not yet assigned) → HR approves directly. */
  store_id: string | null;
  requester: { id: string; full_name: string | null; display_name: string | null; username: string | null } | null;
  leave_type: { code: string; name_th: string; name_en: string } | null;
}

const STATUS_TONE: Record<Status, 'warn' | 'good' | 'critical' | 'neutral'> = {
  pending: 'warn',
  approved: 'good',
  rejected: 'critical',
  cancelled: 'neutral',
};
const STATUS_FILTERS = ['all', 'pending', 'approved', 'rejected', 'cancelled'] as const;

/**
 * HR's view of the leave queue, split by WHO owes the decision (owner change 2026-08-07).
 * Venue managers approve their own team; HR keeps the cases with no manager to fall back on,
 * and can still step in anywhere.
 *
 *  manager_pending — waiting on a venue manager. HR may approve on their behalf.
 *  manager_done    — already approved. Nothing to do here; corrections go to /hr/timesheet.
 *  hr_pending      — no venue (company-level / unassigned), so it was always HR's to decide.
 */
type Queue = 'manager_pending' | 'manager_done' | 'hr_pending' | 'all';

const QUEUES: { key: Queue; label: string; hint: string; status: string }[] = [
  { key: 'manager_pending', label: 'รอหัวหน้าสาขาอนุมัติ', hint: 'HR กดอนุมัติแทนได้', status: 'pending' },
  { key: 'manager_done', label: 'อนุมัติแล้ว', hint: 'ไม่ต้องทำอะไร — แก้ไขที่ /hr/timesheet', status: 'approved' },
  { key: 'hr_pending', label: 'ไม่มีสังกัด — HR อนุมัติ', hint: 'พนักงานที่ยังไม่มีสาขา/ระดับบริษัท', status: 'pending' },
  { key: 'all', label: 'ทั้งหมด', hint: '', status: 'all' },
];

// ── Quota & stats view (per-year quota overrides + usage matrix) ───────────────
interface QuotaType {
  id: string;
  company_id: string | null;
  code: string;
  name_th: string;
  name_en: string;
  annual_quota_days: number | null;
}
interface QuotaEmployee {
  employee_id: string;
  profile_id: string;
  company_id: string | null;
  name: string;
  nickname: string | null;
  position: string | null;
}
interface QuotaBalance {
  employee_id: string;
  leave_type_id: string;
  quota_days: number;
}
interface QuotaUsed {
  user_id: string;
  leave_type_id: string;
  month: number; // 1-12
  days: number;
}
interface QuotaPending {
  user_id: string;
  leave_type_id: string;
  days: number;
}
interface QuotaData {
  year: number;
  types: QuotaType[];
  employees: QuotaEmployee[];
  balances: QuotaBalance[];
  used: QuotaUsed[];
  pending: QuotaPending[];
}

const MONTHS_TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const MAX_QUOTA_DAYS = 366;

// Day counts can be half-days (numeric): whole numbers plain, otherwise 1 decimal.
function fmtDays(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export default function HrLeavesPage() {
  const t = useTranslations('hr.leaves');
  // in-app replacement for the window.prompt quota editor
  const { prompt, dialog: promptDialog } = usePromptDialog();

  const [stores, setStores] = useState<StoreOpt[]>([]);
  const [storeId, setStoreId] = useState(''); // '' = company-wide (no store_id)
  const [status, setStatus] = useState<string>('pending');
  const [queue, setQueue] = useState<Queue>('manager_pending');

  const [rows, setRows] = useState<LeaveRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [certLoadingId, setCertLoadingId] = useState<string | null>(null);
  const [view, setView] = useViewMode('hr-leaves');

  // Quota & stats: fetched once (cross-company — no company selector on this page,
  // so the quota API is called WITHOUT company_id and returns every visible company).
  const [quota, setQuota] = useState<QuotaData | null>(null);
  const [quotaSearch, setQuotaSearch] = useState('');
  const [quotaLoading, setQuotaLoading] = useState(true);
  const [mode, setMode] = useState<'requests' | 'quota'>('requests');

  const statusLabel = useCallback(
    (s: Status) =>
      s === 'pending'
        ? t('statusPending')
        : s === 'approved'
          ? t('statusApproved')
          : s === 'rejected'
            ? t('statusRejected')
            : t('statusCancelled'),
    [t]
  );

  // manageable stores (same source as /hr/requests)
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/hr/manageable-stores');
        const json = await res.json();
        setStores((json.data ?? []) as StoreOpt[]);
      } catch {
        setStores([]);
      }
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (storeId) params.set('store_id', storeId);
      // The queue drives the status; 'ทั้งหมด' falls back to the raw status filter.
      const effectiveStatus = queue === 'all' ? status : QUEUES.find((q) => q.key === queue)!.status;
      if (effectiveStatus !== 'all') params.set('status', effectiveStatus);
      const qs = params.toString();
      const res = await fetch(`/api/hr/leaves${qs ? `?${qs}` : ''}`);
      if (!res.ok) throw new Error();
      const json = await res.json();
      const all = (json.data ?? []) as LeaveRow[];
      // Split on whether the request belongs to a venue: with a store there is a manager who owes
      // the decision; without one it was always HR's.
      setRows(
        queue === 'manager_pending' ? all.filter((r) => r.store_id)
        : queue === 'hr_pending' ? all.filter((r) => !r.store_id)
        : all
      );
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
      setRejectId(null);
      setRejectNote('');
    }
  }, [storeId, status, queue]);

  useEffect(() => {
    load();
  }, [load]);

  const loadQuota = useCallback(async () => {
    setQuotaLoading(true);
    try {
      const res = await fetch('/api/hr/leaves/quota');
      if (!res.ok) throw new Error();
      const json = await res.json();
      setQuota((json.data ?? null) as QuotaData | null);
    } catch {
      // Silent: chips simply don't render and the quota view shows the empty state.
      setQuota(null);
    } finally {
      setQuotaLoading(false);
    }
  }, []);

  useEffect(() => {
    loadQuota();
  }, [loadQuota]);

  // Lookup maps for the quota payload.
  const employeeByProfile = useMemo(() => {
    const map = new Map<string, QuotaEmployee>();
    (quota?.employees ?? []).forEach((e) => map.set(e.profile_id, e));
    return map;
  }, [quota]);
  const balanceMap = useMemo(() => {
    const map = new Map<string, number>();
    (quota?.balances ?? []).forEach((b) => map.set(`${b.employee_id}|${b.leave_type_id}`, b.quota_days));
    return map;
  }, [quota]);
  const usedByUserType = useMemo(() => {
    const map = new Map<string, number>();
    (quota?.used ?? []).forEach((u) => {
      const key = `${u.user_id}|${u.leave_type_id}`;
      map.set(key, Math.round(((map.get(key) ?? 0) + u.days) * 10) / 10);
    });
    return map;
  }, [quota]);
  // Days already in the queue for this person+type. They hold quota, so the approver has to see
  // them before pressing approve — otherwise two requests that each look affordable get approved
  // in turn and the second one lands the person over.
  const pendingByUserType = useMemo(() => {
    const map = new Map<string, number>();
    (quota?.pending ?? []).forEach((p) => {
      const key = `${p.user_id}|${p.leave_type_id}`;
      map.set(key, Math.round(((map.get(key) ?? 0) + p.days) * 10) / 10);
    });
    return map;
  }, [quota]);
  /**
   * Name search over the quota grid — 131 rows is too many to scan for one person.
   *
   * Every token must match somewhere in "ชื่อจริงนามสกุล ชื่อเล่น", so word order does not matter:
   * hr_employees.full_name holds the first and last name in one string, and typing them the other
   * way round is the obvious thing to do when you only remember the surname.
   */
  const visibleQuotaEmployees = useMemo(
    () => (quota?.employees ?? []).filter((e) => matchesEmployeeSearch(e, quotaSearch)),
    [quota, quotaSearch]
  );

  const monthlyByUser = useMemo(() => {
    const map = new Map<string, number[]>();
    (quota?.used ?? []).forEach((u) => {
      const months = map.get(u.user_id) ?? Array.from({ length: 12 }, () => 0);
      months[u.month - 1] = Math.round((months[u.month - 1] + u.days) * 10) / 10;
      map.set(u.user_id, months);
    });
    return map;
  }, [quota]);
  // Types worth a quota column: a type-wide default OR at least one per-employee override.
  const quotaTypes = useMemo(
    () =>
      (quota?.types ?? []).filter(
        (ty) =>
          ty.annual_quota_days != null ||
          (quota?.balances ?? []).some((b) => b.leave_type_id === ty.id)
      ),
    [quota]
  );

  /**
   * ONE COLUMN PER LEAVE TYPE, not per (company × leave type).
   *
   * hr_leave_types stores a separate row for every company, so "ลาสมรส" is four rows and the grid
   * drew four near-identical columns — 61 of them in all, most blank for any given person (owner
   * report 2026-08-27). Grouping by code collapses that to 15, and each cell then resolves the row
   * belonging to THAT employee's company, which is the only one their leave ever uses.
   */
  const typeGroups = useMemo(() => {
    const groups = new Map<string, { code: string; label: string; members: QuotaType[] }>();
    for (const ty of quotaTypes) {
      const g = groups.get(ty.code) ?? { code: ty.code, label: ty.name_th, members: [] };
      g.members.push(ty);
      groups.set(ty.code, g);
    }
    return [...groups.values()].map((g) => {
      // Companies may name the same code differently (HR Test Co calls `personal`
      // "ลากิจไม่รับค่าจ้าง"). Head the column with the most common name and keep the rest for the
      // tooltip, rather than silently showing one company's wording as everyone's.
      const tally = new Map<string, number>();
      g.members.forEach((m) => tally.set(m.name_th, (tally.get(m.name_th) ?? 0) + 1));
      const names = [...tally.entries()].sort((a, b) => b[1] - a[1]);
      return { ...g, label: names[0]?.[0] ?? g.label, variants: names.length > 1 ? names.map(([n]) => n) : null };
    });
  }, [quotaTypes]);

  /** The row of this group that applies to this employee: their own company's, else a shared one. */
  const typeForEmployee = useCallback(
    (members: QuotaType[], companyId: string | null): QuotaType | undefined =>
      members.find((m) => m.company_id === companyId) ?? members.find((m) => m.company_id === null),
    []
  );

  // Effective quota/used/remaining for one employee × leave type; null when unlimited.
  const quotaInfo = useCallback(
    (profileId: string | undefined, leaveTypeId: string) => {
      if (!quota || !profileId) return null;
      const emp = employeeByProfile.get(profileId);
      const type = quota.types.find((ty) => ty.id === leaveTypeId);
      if (!type) return null;
      const override = emp ? balanceMap.get(`${emp.employee_id}|${leaveTypeId}`) : undefined;
      const effective = override ?? type.annual_quota_days;
      if (effective == null) return null;
      const used = usedByUserType.get(`${profileId}|${leaveTypeId}`) ?? 0;
      const pending = pendingByUserType.get(`${profileId}|${leaveTypeId}`) ?? 0;
      return {
        quota: effective,
        used,
        pending,
        // What is genuinely left AFTER everything already claimed — the number the approve button
        // is really deciding against.
        remaining: Math.round((effective - used - pending) * 10) / 10,
      };
    },
    [quota, employeeByProfile, balanceMap, usedByUserType, pendingByUserType]
  );

  const editQuota = useCallback(
    async (emp: QuotaEmployee, ty: QuotaType) => {
      if (!quota) return;
      const current = balanceMap.get(`${emp.employee_id}|${ty.id}`);
      // NOT required: submitting an empty value clears the override (falls back to the type default)
      const input = await prompt({
        title: t('setQuotaTitle'),
        message: t('setQuotaPrompt', { name: emp.name, type: ty.name_th, year: String(quota.year) }),
        inputType: 'number',
        initialValue: current != null ? fmtDays(current) : '',
        confirmLabel: t('save'),
        cancelLabel: t('cancel'),
      });
      if (input === null) return;
      const trimmed = input.trim();
      let quotaDays: number | null = null;
      if (trimmed !== '') {
        const n = Number(trimmed);
        if (!Number.isFinite(n) || n < 0 || n > MAX_QUOTA_DAYS) {
          toast({ type: 'error', title: t('quotaInvalid') });
          return;
        }
        quotaDays = n;
      }
      try {
        const res = await fetch('/api/hr/leaves/quota', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            employee_id: emp.employee_id,
            leave_type_id: ty.id,
            year: quota.year,
            quota_days: quotaDays,
          }),
        });
        if (!res.ok) throw new Error();
        toast({ type: 'success', title: t('quotaSaved') });
        await loadQuota();
      } catch {
        toast({ type: 'error', title: t('quotaSaveFailed') });
      }
    },
    [quota, balanceMap, t, prompt, loadQuota]
  );

  const decide = useCallback(
    async (id: string, decision: 'approved' | 'rejected', note?: string) => {
      const send = async (override?: { reason: string }) =>
        fetch(`/api/hr/leaves/${id}/decide`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            decision,
            note: note?.trim() || undefined,
            ...(override ? { override_quota: true, override_reason: override.reason } : {}),
          }),
        });

      try {
        let res = await send();
        let json = await res.json().catch(() => ({}));

        // Over quota is a decision, not a dead end (owner ask 2026-08-27): show the arithmetic the
        // server computed, take a reason, and let the approver proceed. The reason is recorded on
        // the audit row, so "who was let past, by how much, why" stays answerable.
        if (res.status === 409 && json?.code === 'quota_exceeded') {
          const reason = await prompt({
            title: 'เกินโควตา — ยืนยันอนุมัติ?',
            message: `${json.error}

ระบุเหตุผลที่อนุมัติเกินโควตา (บันทึกไว้ในประวัติ)`,
            confirmLabel: 'ยืนยันอนุมัติ',
            cancelLabel: t('cancel'),
          });
          if (!reason || !reason.trim()) return;
          res = await send({ reason: reason.trim() });
          json = await res.json().catch(() => ({}));
        }

        if (!res.ok) throw new Error(json?.error || json?.message);
        toast({
          type: 'success',
          title: decision === 'approved' ? t('approved') : t('rejected'),
        });
        // Decision may have succeeded while its balance-apply side-effect warned — surface it.
        if (json?.warning) toast({ type: 'warning', title: json.warning });
        await load();
      } catch (e) {
        toast({
          type: 'error',
          title: e instanceof Error && e.message ? e.message : t('actionFailed'),
        });
      }
    },
    [t, load, prompt]
  );

  const viewCert = useCallback(
    async (id: string) => {
      setCertLoadingId(id);
      try {
        // Store-scoped cert viewer: authorized to whoever may decide this leave
        // (store manager or HR), unlike the HR-only /api/hr/documents endpoint.
        const res = await fetch(`/api/hr/leaves/${id}/cert`);
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.url) throw new Error();
        window.open(json.url as string, '_blank', 'noopener,noreferrer');
      } catch {
        toast({ type: 'error', title: t('certLoadFailed') });
      } finally {
        setCertLoadingId(null);
      }
    },
    [t]
  );

  const storeOptions = [
    { value: '', label: t('allStores') },
    ...stores.map((s) => ({ value: s.id, label: s.store_name })),
  ];
  const statusOptions = STATUS_FILTERS.map((s) => ({
    value: s,
    label: s === 'all' ? t('statusAll') : statusLabel(s as Status),
  }));

  const renderDecideBar = (id: string, s: Status) =>
    s === 'pending' &&
    (rejectId === id ? (
      <div className="flex w-full flex-wrap items-center gap-2">
        <input
          type="text"
          value={rejectNote}
          onChange={(e) => setRejectNote(e.target.value)}
          placeholder={t('decisionNote')}
          className="control flex-1"
        />
        <Button size="sm" variant="danger" onClick={() => decide(id, 'rejected', rejectNote)}>
          {t('reject')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setRejectId(null);
            setRejectNote('');
          }}
        >
          {t('cancel')}
        </Button>
      </div>
    ) : (
      <>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setRejectId(id);
            setRejectNote('');
          }}
        >
          {t('reject')}
        </Button>
        <Button size="sm" onClick={() => decide(id, 'approved')}>
          {t('approve')}
        </Button>
      </>
    ));

  const renderQuotaChip = (r: LeaveRow) => {
    if (r.status !== 'pending') return null;
    const info = quotaInfo(r.requester?.id, r.leave_type_id);
    if (!info) return null;
    // `remaining` already has this request's own pending days subtracted, so add them back before
    // asking whether approving it would overshoot.
    const remainingExcludingThis = Math.round((info.remaining + r.days) * 10) / 10;
    const over = remainingExcludingThis < r.days;
    return (
      <span
        className={`mt-1 inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-[11px] font-medium tabular-nums ${
          over
            ? 'border-red-200 bg-red-50 text-red-600 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400'
            : 'border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-600 dark:bg-gray-700/60 dark:text-gray-300'
        }`}
      >
        โควตา {fmtDays(info.quota)} · อนุมัติแล้ว {fmtDays(info.used)}
        {info.pending > 0 && <> · รออนุมัติ {fmtDays(info.pending)}</>} · คงเหลือ{' '}
        {fmtDays(remainingExcludingThis)} · ใบนี้ขอ {fmtDays(r.days)}
        {over && <> → เกิน {fmtDays(Math.round((r.days - remainingExcludingThis) * 10) / 10)} วัน</>}
      </span>
    );
  };

  const remainingClass = (remaining: number) =>
    remaining > 0
      ? 'text-emerald-600 dark:text-emerald-400'
      : remaining === 0
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-red-600 dark:text-red-400';

  const renderQuotaView = () => {
    if (quotaLoading) return <SkeletonList rows={5} />;
    if (!quota || quota.employees.length === 0) {
      return (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-gray-300 px-4 py-12 text-center text-sm text-gray-400 dark:border-gray-700">
          <Inbox className="h-8 w-8" />
          {t('noEmployees')}
        </div>
      );
    }
    const total = quota.employees.length;
    const shown = visibleQuotaEmployees.length;
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
            {t('quotaYearHeading', { year: String(quota.year) })}
          </h2>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
              <input
                type="search"
                value={quotaSearch}
                onChange={(e) => setQuotaSearch(e.target.value)}
                placeholder="ค้นหาชื่อ / นามสกุล / ชื่อเล่น"
                aria-label="ค้นหาพนักงานในตารางโควตา"
                className="control w-56 py-1 pl-8 text-xs sm:w-64"
              />
            </div>
            <span className="whitespace-nowrap text-xs tabular-nums text-gray-500 dark:text-gray-400">
              {quotaSearch.trim() ? `แสดง ${shown} จาก ${total} คน` : `${total} คน`}
            </span>
          </div>
        </div>

        {shown === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-gray-300 px-4 py-12 text-center text-sm text-gray-400 dark:border-gray-700">
            <Inbox className="h-8 w-8" />
            ไม่พบพนักงานที่ตรงกับ &quot;{quotaSearch.trim()}&quot;
            <button
              type="button"
              onClick={() => setQuotaSearch('')}
              className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
            >
              ล้างคำค้น
            </button>
          </div>
        ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
          <table className="w-full min-w-max border-collapse text-xs">
            <thead className="bg-gray-50 text-gray-500 dark:bg-gray-800/60 dark:text-gray-400">
              <tr>
                <th
                  rowSpan={2}
                  className="sticky left-0 z-10 bg-gray-50 px-3 py-2 text-left font-medium dark:bg-gray-800"
                >
                  {t('employeeCol')}
                </th>
                {typeGroups.map((g) => (
                  <th
                    key={g.code}
                    rowSpan={2}
                    className="whitespace-nowrap px-2 py-2 text-center font-medium"
                    title={g.variants ? `บางบริษัทเรียก: ${g.variants.join(' · ')}` : undefined}
                  >
                    {g.label}
                  </th>
                ))}
                <th colSpan={12} className="border-l border-gray-200 px-2 py-1.5 text-center font-medium dark:border-gray-700">
                  {t('monthlyTotalCol')}
                </th>
              </tr>
              <tr>
                {MONTHS_TH.map((m, i) => (
                  <th
                    key={m}
                    className={`px-1.5 py-1 text-center font-normal ${i === 0 ? 'border-l border-gray-200 dark:border-gray-700' : ''}`}
                  >
                    {m}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800">
              {visibleQuotaEmployees.map((emp) => {
                const months = monthlyByUser.get(emp.profile_id);
                return (
                  <tr key={emp.employee_id} className="border-t border-gray-100 dark:border-gray-700/60">
                    <td className="sticky left-0 z-10 whitespace-nowrap bg-white px-3 py-1.5 dark:bg-gray-800">
                      <EmployeeName name={emp.name} nickname={emp.nickname} className="font-medium text-gray-900 dark:text-white" />
                      {emp.position && (
                        <span className="block text-[10px] text-gray-400 dark:text-gray-500">{emp.position}</span>
                      )}
                    </td>
                    {typeGroups.map((g) => {
                      const ty = typeForEmployee(g.members, emp.company_id);
                      // Their company does not offer this leave at all — an em dash, not a 0/0 that
                      // reads as "used none of an allowance they have".
                      if (!ty) {
                        return (
                          <td key={g.code} className="px-2 py-1.5 text-center text-gray-300 dark:text-gray-600">
                            <span title="บริษัทของพนักงานคนนี้ไม่มีประเภทการลานี้">·</span>
                          </td>
                        );
                      }
                      const override = balanceMap.get(`${emp.employee_id}|${ty.id}`);
                      const effective = override ?? ty.annual_quota_days;
                      const used = usedByUserType.get(`${emp.profile_id}|${ty.id}`) ?? 0;
                      const remaining = effective == null ? null : Math.round((effective - used) * 10) / 10;
                      return (
                        <td key={g.code} className="px-2 py-1.5 text-center">
                          <button
                            type="button"
                            onClick={() => editQuota(emp, ty)}
                            title={t('setQuotaTitle')}
                            className={`font-medium tabular-nums hover:underline ${
                              remaining == null ? 'text-gray-400 dark:text-gray-500' : remainingClass(remaining)
                            }`}
                          >
                            {effective != null ? `${fmtDays(used)}/${fmtDays(effective)}` : '—'}
                          </button>
                        </td>
                      );
                    })}
                    {MONTHS_TH.map((m, i) => {
                      const d = months?.[i] ?? 0;
                      return (
                        <td
                          key={m}
                          className={`px-1.5 py-1.5 text-center tabular-nums ${
                            i === 0 ? 'border-l border-gray-100 dark:border-gray-700/60' : ''
                          } ${d > 0 ? 'text-gray-700 dark:text-gray-200' : 'text-gray-300 dark:text-gray-600'}`}
                        >
                          {d > 0 ? fmtDays(d) : '·'}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        )}
      </div>
    );
  };

  return (
    /*
     * Width follows the view, because the two halves of this page want opposite things.
     *
     * The approval queue is a column of request cards — read top to bottom, and stretching them
     * across a 1900px monitor only makes the eye travel further between the name and the buttons.
     * 6xl matches every other HR queue (employees, claims, attendance, audit).
     *
     * The quota matrix is a grid: 11 leave types plus 12 months plus the name column. Capping it at
     * 4xl left it scrolling sideways inside a narrow card with empty page either side of it
     * (owner report 2026-08-27). It gets the whole viewport; the first column stays sticky, so the
     * scrolling that remains at least keeps the name in view.
     */
    <div className={`mx-auto space-y-4 p-4 ${mode === 'quota' ? 'max-w-none' : 'max-w-6xl'}`}>
      <PageHeader
        title={t('hrTitle')}
        subtitle={t('hrSubtitle')}
        actions={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setMode((m) => (m === 'requests' ? 'quota' : 'requests'))}
              icon={
                mode === 'requests' ? (
                  <CalendarRange className="h-4 w-4" />
                ) : (
                  <ListChecks className="h-4 w-4" />
                )
              }
            >
              {mode === 'requests' ? t('quotaViewBtn') : t('requestsViewBtn')}
            </Button>
            {mode === 'requests' && <ViewToggle value={view} onChange={setView} />}
          </div>
        }
      />

      {mode === 'quota' ? (
        renderQuotaView()
      ) : (
        <>
          {/* Queue split — who owes the decision (2026-08-07) */}
          <div className="flex flex-wrap gap-1 rounded-xl bg-gray-100 p-1 dark:bg-gray-800">
            {QUEUES.map((q) => (
              <button
                key={q.key}
                type="button"
                onClick={() => setQueue(q.key)}
                title={q.hint || undefined}
                className={`flex-1 cursor-pointer whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  queue === q.key
                    ? 'bg-white text-indigo-600 shadow-sm dark:bg-gray-700 dark:text-indigo-300'
                    : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                }`}
              >
                {q.label}
              </button>
            ))}
          </div>
          {queue !== 'all' && (
            <p className="-mt-1 text-xs text-gray-500 dark:text-gray-400">
              {QUEUES.find((q) => q.key === queue)!.hint}
              {queue === 'manager_done' && (
                <>
                  {' — '}
                  <Link href="/hr/timesheet" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                    ไปหน้า timesheet
                  </Link>
                </>
              )}
            </p>
          )}

          {/* filters */}
          <div className="grid grid-cols-2 gap-3">
            <Select
              label={t('storeLabel')}
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
              options={storeOptions}
            />
            {queue === 'all' && (
              <Select
                label={t('status')}
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                options={statusOptions}
              />
            )}
          </div>

          {loading ? (
            <SkeletonList rows={5} />
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-gray-300 px-4 py-12 text-center text-sm text-gray-400 dark:border-gray-700">
              <Inbox className="h-8 w-8" />
              {t('noRequests')}
            </div>
          ) : (
            <DataList compact={view === 'compact'}>
              {rows.map((r) => (
                <DataCard
                  key={r.id}
                  accent={STATUS_TONE[r.status]}
                  title={
                    <>
                      <EmployeeName source={r.requester} />
                      {' · '}
                      {r.leave_type?.name_th ?? r.leave_type?.name_en ?? '—'}
                    </>
                  }
                  subtitle={
                    <>
                      {formatThaiDate(r.from_date)}
                      {r.to_date !== r.from_date && ` → ${formatThaiDate(r.to_date)}`}
                      {' · '}
                      {t('daysPreview', { days: r.days })}
                    </>
                  }
                  status={<StatusBadge tone={STATUS_TONE[r.status]} label={statusLabel(r.status)} />}
                  actions={renderDecideBar(r.id, r.status)}
                >
                  <p>{r.reason}</p>
                  {renderQuotaChip(r)}
                  {r.cert_path && (
                    <button
                      type="button"
                      onClick={() => viewCert(r.id)}
                      disabled={certLoadingId === r.id}
                      className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline disabled:opacity-60 dark:text-indigo-400"
                    >
                      {certLoadingId === r.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <FileText className="h-3.5 w-3.5" />
                      )}
                      {t('viewCert')}
                    </button>
                  )}
                </DataCard>
              ))}
            </DataList>
          )}
        </>
      )}

      {promptDialog}
    </div>
  );
}
