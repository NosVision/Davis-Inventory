'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, CalendarOff, Send, ChevronDown, ChevronUp } from 'lucide-react';
import { TileNotices } from '../_components/tile-notices';
import {
  Button,
  toast,
  PageHeader,
  StatusBadge,
  DataCard,
  DataList,
  ViewToggle,
  useViewMode,
  useConfirm,
} from '@/components/ui';
import { todayBangkok } from '@/lib/utils/date';
import { formatThaiDate } from '@/lib/utils/format';

type Status = 'pending' | 'approved' | 'rejected' | 'cancelled';

interface LeaveType {
  id: string;
  code: string;
  name_th: string;
  name_en: string;
  requires_cert: boolean;
  requires_reason: boolean;
  advance_notice_days: number;
  probational_allowed: boolean;
  paid: boolean;
}

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
  decided_at: string | null;
  created_at: string;
  leave_type: { code: string; name_th: string; name_en: string } | null;
}

// Narrowed to the tones valid for both <StatusBadge> and the <DataCard accent> rail.
const STATUS_TONE: Record<Status, 'neutral' | 'good' | 'warn' | 'critical'> = {
  pending: 'warn',
  approved: 'good',
  rejected: 'critical',
  cancelled: 'neutral',
};

// ── Yearly quota summary (/api/hr/ess/leaves/summary) ─────────────────────────
interface SummaryType {
  id: string;
  code: string;
  name_th: string;
  name_en: string;
  quota: number | null; // effective (override ?? type default); null = unlimited
  used: number; // approved requests + `carried` below
  carried: number; // of `used`: days taken this year before the app recorded leave (00199)
  pending: number; // days sitting in the approval queue — already held against the quota
  remaining: number | null; // quota − used − pending
}
interface LeaveSummary {
  year: number;
  types: SummaryType[];
  monthly: number[]; // 12 entries, index 0 = January
}

const MONTHS_TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

// Day counts can be half-days (numeric): whole numbers plain, otherwise 1 decimal.
function fmtDays(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

// Inclusive day count between two YYYY-MM-DD strings; 0 when invalid.
function inclusiveDays(from: string, to: string): number {
  if (!from || !to) return 0;
  const f = new Date(`${from}T00:00:00`);
  const t = new Date(`${to}T00:00:00`);
  if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime()) || t < f) return 0;
  return Math.round((t.getTime() - f.getTime()) / 86400000) + 1;
}

export default function MyLeavesPage() {
  const t = useTranslations('hr.leaves');
  const { confirm, dialog } = useConfirm();

  const [types, setTypes] = useState<LeaveType[]>([]);
  const [rows, setRows] = useState<LeaveRow[]>([]);
  const [summary, setSummary] = useState<LeaveSummary | null>(null);
  // Small screens: unused quota types are collapsed by default (owner ask 2026-07-15) —
  // only types with actual usage show, the rest unfold behind "show all".
  const [showAllTypes, setShowAllTypes] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [view, setView] = useViewMode('me-leaves');

  const today = todayBangkok();
  const currentMonthIdx = Number(today.slice(5, 7)) - 1;
  const [typeId, setTypeId] = useState('');
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [reason, setReason] = useState('');
  const [cert, setCert] = useState<File | null>(null);

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

  const selectedType = useMemo(
    () => types.find((ty) => ty.id === typeId) ?? null,
    [types, typeId]
  );
  const quotaTypes = useMemo(() => (summary?.types ?? []).filter((ty) => ty.quota != null), [summary]);
  const usedQuotaTypes = useMemo(() => quotaTypes.filter((ty) => ty.used > 0), [quotaTypes]);
  // Collapsing the unused types only makes sense when SOMETHING has been used — otherwise the
  // employee opens "ดูโควตา" and gets an empty box. 119 of 123 staff have taken no leave this
  // year, so that was almost everyone (owner report 2026-08-07).
  const visibleQuotaTypes = showAllTypes || usedQuotaTypes.length === 0 ? quotaTypes : usedQuotaTypes;
  const collapsedCount = quotaTypes.length - usedQuotaTypes.length;
  const requiresCert = Boolean(selectedType?.requires_cert);
  // reason mandatory unless the type opts out (requires_reason=false)
  const requiresReason = selectedType?.requires_reason !== false;
  const dayCount = inclusiveDays(fromDate, toDate);

  const fetchTypes = useCallback(async () => {
    try {
      const res = await fetch('/api/hr/ess/leave-types');
      if (!res.ok) throw new Error('load failed');
      const json = await res.json();
      const list = (json.data ?? []) as LeaveType[];
      setTypes(list);
      setTypeId((prev) => prev || list[0]?.id || '');
    } catch {
      setTypes([]);
    }
  }, []);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/hr/ess/leaves');
      if (!res.ok) throw new Error('load failed');
      const json = await res.json();
      setRows((json.data ?? []) as LeaveRow[]);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchSummary = useCallback(async () => {
    try {
      const res = await fetch('/api/hr/ess/leaves/summary');
      if (!res.ok) throw new Error('load failed');
      const json = await res.json();
      setSummary((json.data ?? null) as LeaveSummary | null);
    } catch {
      // Silent: the summary section simply doesn't render.
      setSummary(null);
    }
  }, []);

  useEffect(() => {
    fetchTypes();
    fetchRows();
    fetchSummary();
  }, [fetchTypes, fetchRows, fetchSummary]);

  const submit = useCallback(async () => {
    if (!typeId || !fromDate || !toDate || dayCount <= 0) return;
    if (requiresReason && !reason.trim()) return;
    if (requiresCert && !cert) {
      toast({ type: 'error', title: t('certRequired') });
      return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('leave_type_id', typeId);
      fd.append('from_date', fromDate);
      fd.append('to_date', toDate);
      fd.append('reason', reason.trim());
      if (cert) fd.append('cert', cert);
      // NOTE: do not set Content-Type — the browser sets the multipart boundary.
      const res = await fetch('/api/hr/ess/leaves', { method: 'POST', body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || json?.message || t('fileFailed'));
      toast({ type: 'success', title: t('filed') });
      setReason('');
      setCert(null);
      setFromDate(today);
      setToDate(today);
      await fetchRows();
    } catch (e) {
      toast({ type: 'error', title: e instanceof Error ? e.message : t('fileFailed') });
    } finally {
      setSubmitting(false);
    }
  }, [typeId, fromDate, toDate, reason, dayCount, requiresCert, requiresReason, cert, t, today, fetchRows]);

  const cancel = useCallback(
    async (id: string) => {
      if (!(await confirm({ title: t('confirmCancel'), tone: 'danger', confirmLabel: t('cancel') }))) return;
      try {
        const res = await fetch(`/api/hr/ess/leaves/${id}/cancel`, { method: 'POST' });
        if (!res.ok) throw new Error();
        toast({ type: 'success', title: t('cancelled') });
        await fetchRows();
      } catch {
        toast({ type: 'error', title: t('actionFailed') });
      }
    },
    [t, fetchRows, confirm]
  );

  const canSubmit =
    Boolean(typeId && fromDate && toDate) &&
    (!requiresReason || Boolean(reason.trim())) &&
    dayCount > 0 &&
    (!requiresCert || Boolean(cert)) &&
    !submitting;

  return (
    <div className="mx-auto max-w-lg space-y-4 p-4">
      <PageHeader
        title={t('title')}
        subtitle={t('mySubtitle')}
        actions={<ViewToggle value={view} onChange={setView} />}
      />

      <TileNotices tile="leaves" />

      {/* Yearly quota summary */}
      {summary && (summary.types.some((ty) => ty.quota != null || ty.used > 0) || summary.monthly.some((d) => d > 0)) && (
        <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
            {t('summaryHeading', { year: String(summary.year) })}
          </h2>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {visibleQuotaTypes
              .map((ty) => {
                const quotaDays = ty.quota as number;
                const remaining = ty.remaining ?? 0;
                const depleted = remaining <= 0;
                // The bar fills with days that are spoken for — approved AND pending — because
                // that is what "remaining" now subtracts. A bar that ignored pending would show
                // room the next request would immediately be refused for.
                const claimed = ty.used + ty.pending;
                const pct =
                  quotaDays > 0 ? Math.min(100, Math.max(0, (claimed / quotaDays) * 100)) : 100;
                // Traffic-light bar by % remaining: >50% green, >20% amber, else red.
                const remainPct = quotaDays > 0 ? Math.max(0, (remaining / quotaDays) * 100) : 0;
                const barColor =
                  remainPct > 50 ? 'bg-emerald-500' : remainPct > 20 ? 'bg-amber-500' : 'bg-red-500';
                return (
                  <div
                    key={ty.id}
                    className="rounded-lg border border-gray-100 p-3 dark:border-gray-700"
                  >
                    <p className="text-xs font-medium text-gray-900 dark:text-white">{ty.name_th}</p>
                    <p
                      className={`mt-0.5 text-[11px] tabular-nums ${
                        depleted ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'
                      }`}
                    >
                      {t('remainingOf', {
                        remaining: fmtDays(remaining),
                        quota: fmtDays(quotaDays),
                        used: fmtDays(ty.used),
                      })}
                    </p>
                    {ty.carried > 0 && (
                      // Otherwise the card says "ใช้ไป 6 วัน" over a leave history with nothing in
                      // it — those days were taken before the app started recording requests.
                      <p className="mt-0.5 text-[11px] tabular-nums text-gray-400 dark:text-gray-500">
                        รวมวันที่ใช้ไปก่อนเริ่มใช้ระบบ {fmtDays(ty.carried)} วัน
                      </p>
                    )}
                    {ty.pending > 0 && (
                      <p className="mt-0.5 text-[11px] tabular-nums text-amber-600 dark:text-amber-400">
                        รออนุมัติอีก {fmtDays(ty.pending)} วัน — กันยอดไว้แล้ว
                      </p>
                    )}
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
                      <div
                        className={`h-full rounded-full ${barColor}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
          </div>

          {collapsedCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAllTypes((v) => !v)}
              className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
            >
              {showAllTypes ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              {showAllTypes ? t('hideUnusedTypes') : t('showAllTypes', { count: collapsedCount })}
            </button>
          )}

          {summary.types
            .filter((ty) => ty.quota == null && ty.used > 0)
            .map((ty) => (
              <p key={ty.id} className="text-[11px] tabular-nums text-gray-500 dark:text-gray-400">
                {ty.name_th} · {t('usedOnly', { used: fmtDays(ty.used) })}
              </p>
            ))}

          {/* 12-month strip (current year, all types) */}
          <div>
            <p className="mb-1 text-[11px] font-medium text-gray-500 dark:text-gray-400">
              {t('monthlyStripHeading')}
            </p>
            <div className="grid grid-cols-12 gap-1">
              {MONTHS_TH.map((m, i) => {
                const d = summary.monthly[i] ?? 0;
                const isCurrent = i === currentMonthIdx;
                const max = Math.max(...summary.monthly, 1);
                return (
                  <div key={m} className="flex flex-col items-center gap-0.5">
                    <div className="flex h-10 w-full items-end">
                      <div
                        className={`w-full rounded-sm ${
                          d > 0
                            ? isCurrent
                              ? 'bg-indigo-500'
                              : 'bg-indigo-300 dark:bg-indigo-700'
                            : 'bg-gray-100 dark:bg-gray-700'
                        }`}
                        style={{ height: d > 0 ? `${Math.max(15, (d / max) * 100)}%` : '4px' }}
                      />
                    </div>
                    <span
                      className={`text-[9px] tabular-nums ${
                        isCurrent
                          ? 'font-semibold text-indigo-600 dark:text-indigo-400'
                          : 'text-gray-400 dark:text-gray-500'
                      }`}
                    >
                      {m}
                    </span>
                    <span className="h-3 text-[9px] tabular-nums text-gray-500 dark:text-gray-400">
                      {d > 0 ? fmtDays(d) : ''}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* File form */}
      <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{t('fileHeading')}</h2>

        <label className="flex flex-col text-xs font-medium text-gray-600 dark:text-gray-400">
          {t('leaveType')}
          <select
            value={typeId}
            onChange={(e) => setTypeId(e.target.value)}
            className="control mt-1"
          >
            {types.length === 0 && <option value="">{t('noTypes')}</option>}
            {types.map((ty) => (
              <option key={ty.id} value={ty.id}>
                {ty.name_th}
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col text-xs font-medium text-gray-600 dark:text-gray-400">
            {t('fromDate')}
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="control mt-1"
            />
          </label>
          <label className="flex flex-col text-xs font-medium text-gray-600 dark:text-gray-400">
            {t('toDate')}
            <input
              type="date"
              value={toDate}
              min={fromDate}
              onChange={(e) => setToDate(e.target.value)}
              className="control mt-1"
            />
          </label>
        </div>

        {dayCount > 0 && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t('daysPreview', { days: dayCount })}
          </p>
        )}

        <label className="flex flex-col text-xs font-medium text-gray-600 dark:text-gray-400">
          {t('reason')}
          <textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="control mt-1"
          />
        </label>

        {requiresCert && (
          <label className="flex flex-col text-xs font-medium text-gray-600 dark:text-gray-400">
            {t('certLabel')}
            <input
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => setCert(e.target.files?.[0] ?? null)}
              className="control mt-1 file:mr-3 file:rounded-md file:border-0 file:bg-indigo-50 file:px-3 file:py-1 file:text-xs file:font-medium file:text-indigo-600 dark:file:bg-indigo-900/40 dark:file:text-indigo-300"
            />
            <span className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
              {t('certHint')}
            </span>
          </label>
        )}

        <Button
          size="sm"
          onClick={submit}
          isLoading={submitting}
          disabled={!canSubmit}
          icon={<Send className="h-4 w-4" />}
        >
          {t('submit')}
        </Button>
      </div>

      {/* My leaves */}
      <div>
        <h2 className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">
          {t('myLeavesHeading')}
        </h2>
        {loading ? (
          <div className="flex items-center justify-center py-10 text-gray-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-400 dark:border-gray-700">
            <CalendarOff className="h-8 w-8" />
            {t('noLeaves')}
          </div>
        ) : (
          <DataList compact={view === 'compact'}>
            {rows.map((r) => (
              <DataCard
                key={r.id}
                accent={STATUS_TONE[r.status]}
                title={r.leave_type?.name_th ?? r.leave_type?.name_en ?? '—'}
                status={<StatusBadge tone={STATUS_TONE[r.status]} label={statusLabel(r.status)} />}
                actions={
                  r.status === 'pending' ? (
                    <Button variant="outline" size="sm" onClick={() => cancel(r.id)}>
                      {t('cancel')}
                    </Button>
                  ) : undefined
                }
              >
                <span className="block">
                  {formatThaiDate(r.from_date)}
                  {r.to_date !== r.from_date && ` → ${formatThaiDate(r.to_date)}`}
                  {' · '}
                  {t('daysPreview', { days: r.days })}
                </span>
                <span className="mt-1 block">{r.reason}</span>
                {r.decision_note && (
                  <span className="mt-1 block text-gray-400">{r.decision_note}</span>
                )}
              </DataCard>
            ))}
          </DataList>
        )}
      </div>
      {dialog}
    </div>
  );
}
