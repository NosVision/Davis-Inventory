'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, CalendarClock, Send, AlertTriangle } from 'lucide-react';
import { formatThaiDate, formatThaiDateTime } from '@/lib/utils/format';
import {
  Button,
  toast,
  PageHeader,
  ViewToggle,
  useViewMode,
  StatusBadge,
  DataCard,
  DataList,
} from '@/components/ui';

type Kind = 'missing_in' | 'missing_out' | 'wrong_time' | 'other';
type PunchType = 'in' | 'out' | 'break_start' | 'break_end';

interface OpenDay {
  business_date: string;
  in_ts: string;
  /** Scheduled shift end — the closest thing the system knows to "when you actually left". */
  suggested_out_ts: string | null;
  shift_label: string | null;
  existing_request: { id: string; status: string } | null;
}

interface AttReq {
  id: string;
  business_date: string;
  kind: Kind;
  proposed_type: PunchType | null;
  proposed_ts: string | null;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  decision_note: string | null;
  applied: boolean;
  created_at: string;
}
interface Punch {
  id: string;
  type: PunchType;
  ts: string;
}

// Narrowed to the tones valid for both <StatusBadge> and the <DataCard accent> rail.
const STATUS_TONE: Record<AttReq['status'], 'neutral' | 'good' | 'warn' | 'critical'> = {
  pending: 'warn',
  approved: 'good',
  rejected: 'critical',
  cancelled: 'neutral',
};

const KINDS: Kind[] = ['missing_in', 'missing_out', 'wrong_time', 'other'];
const PUNCH_TYPES: PunchType[] = ['in', 'out', 'break_start', 'break_end'];

export default function MyAttendanceRequestsPage() {
  const t = useTranslations('hr.attendanceRequests');

  const [rows, setRows] = useState<AttReq[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [businessDate, setBusinessDate] = useState('');
  const [kind, setKind] = useState<Kind>('missing_in');
  const [proposedType, setProposedType] = useState<PunchType>('in');
  const [proposedTs, setProposedTs] = useState('');
  const [targetId, setTargetId] = useState('');
  const [reason, setReason] = useState('');
  const [punches, setPunches] = useState<Punch[]>([]);

  /**
   * Days the server can already see are broken: clocked in, never clocked out. Filing used to
   * mean knowing which day was wrong, choosing the right kind, and typing a full timestamp — all
   * of which the server can describe exactly. One tap fills the form instead.
   */
  const [openDays, setOpenDays] = useState<OpenDay[]>([]);
  const [view, setView] = useViewMode('me-attendance-requests');

  const statusLabel = useCallback(
    (s: AttReq['status']) =>
      s === 'pending'
        ? t('statusPending')
        : s === 'approved'
          ? t('statusApproved')
          : s === 'rejected'
            ? t('statusRejected')
            : t('statusCancelled'),
    [t]
  );
  const kindLabel = useCallback(
    (k: Kind) =>
      k === 'missing_in'
        ? t('kindMissingIn')
        : k === 'missing_out'
          ? t('kindMissingOut')
          : k === 'wrong_time'
            ? t('kindWrongTime')
            : t('kindOther'),
    [t]
  );
  const typeLabel = useCallback(
    (pt: PunchType) =>
      pt === 'in'
        ? t('typeIn')
        : pt === 'out'
          ? t('typeOut')
          : pt === 'break_start'
            ? t('typeBreakStart')
            : t('typeBreakEnd'),
    [t]
  );

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/hr/ess/attendance-requests');
      if (!res.ok) throw new Error('load failed');
      const json = await res.json();
      setRows((json.data ?? []) as AttReq[]);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchOpenDays = useCallback(async () => {
    try {
      const res = await fetch('/api/hr/ess/attendance/open-days');
      const json = await res.json().catch(() => ({}));
      if (res.ok) setOpenDays((json.data ?? []) as OpenDay[]);
    } catch {
      /* the prompt just stays hidden */
    }
  }, []);

  useEffect(() => {
    fetchRows();
    fetchOpenDays();
  }, [fetchRows, fetchOpenDays]);

  /** One tap: fill the whole form for a day the server already knows is missing its check-out. */
  const fileForOpenDay = useCallback((d: OpenDay) => {
    setBusinessDate(d.business_date);
    setKind('missing_out');
    setProposedType('out');
    // datetime-local wants local wall-clock without the zone suffix.
    if (d.suggested_out_ts) {
      const dt = new Date(d.suggested_out_ts);
      const pad = (n: number) => String(n).padStart(2, '0');
      setProposedTs(
        `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`
      );
    } else {
      setProposedTs('');
    }
    setReason('');
    document.getElementById('att-req-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  // Load the caller's own punches for the chosen date (for the wrong_time selector).
  useEffect(() => {
    if (kind !== 'wrong_time' || !businessDate) {
      setPunches([]);
      setTargetId('');
      return;
    }
    (async () => {
      try {
        const res = await fetch(`/api/hr/ess/my-punches?date=${businessDate}`);
        const json = await res.json();
        setPunches((json.data ?? []) as Punch[]);
      } catch {
        setPunches([]);
      }
    })();
  }, [kind, businessDate]);

  const submit = useCallback(async () => {
    if (!businessDate || !reason.trim()) return;
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        business_date: businessDate,
        kind,
        reason: reason.trim(),
      };
      if (kind === 'missing_in' || kind === 'missing_out') {
        payload.proposed_type = proposedType;
        payload.proposed_ts = proposedTs ? new Date(proposedTs).toISOString() : undefined;
      } else if (kind === 'wrong_time') {
        payload.target_attendance_id = targetId || undefined;
        payload.proposed_ts = proposedTs ? new Date(proposedTs).toISOString() : undefined;
      }
      const res = await fetch('/api/hr/ess/attendance-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || json?.message || t('fileFailed'));
      toast({ type: 'success', title: t('filed') });
      setBusinessDate('');
      setProposedTs('');
      setTargetId('');
      setReason('');
      await Promise.all([fetchRows(), fetchOpenDays()]);
    } catch (e) {
      toast({ type: 'error', title: e instanceof Error ? e.message : t('fileFailed') });
    } finally {
      setSubmitting(false);
    }
  }, [businessDate, kind, proposedType, proposedTs, targetId, reason, t, fetchRows, fetchOpenDays]);

  const cancel = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/hr/ess/attendance-requests/${id}/cancel`, { method: 'POST' });
        if (!res.ok) throw new Error();
        toast({ type: 'success', title: t('cancelled') });
        await Promise.all([fetchRows(), fetchOpenDays()]);
      } catch {
        toast({ type: 'error', title: t('actionFailed') });
      }
    },
    [t, fetchRows]
  );

  const needsPunchFields = kind === 'missing_in' || kind === 'missing_out';
  const needsTs = needsPunchFields || kind === 'wrong_time';
  const canSubmit =
    Boolean(businessDate && reason.trim()) &&
    !submitting &&
    (!needsTs || Boolean(proposedTs)) &&
    (kind !== 'wrong_time' || Boolean(targetId));

  return (
    <div className="mx-auto max-w-lg space-y-4 p-4">
      <PageHeader
        title={t('title')}
        subtitle={t('mySubtitle')}
        actions={<ViewToggle value={view} onChange={setView} />}
      />

      {/* Days the server already knows are missing a check-out. Shown first because this is the
          only reason most people open this page, and it used to be entirely on them to work out
          which day was wrong and what to type. */}
      {openDays.length > 0 && (
        <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50/70 p-3 dark:border-amber-800/60 dark:bg-amber-900/15">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <p className="text-xs text-amber-800 dark:text-amber-300">
              <span className="font-semibold">คุณมี {openDays.length} วันที่ยังไม่ได้เช็คเอาท์</span>{' '}
              — วันเหล่านี้ยังคิดชั่วโมงทำงานไม่ได้ ต้องส่งคำขอให้ HR อนุมัติก่อน
            </p>
          </div>
          {openDays.map((d) => (
            <div
              key={d.business_date}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/80 px-3 py-2 dark:bg-gray-800/60"
            >
              <div className="min-w-0 text-xs">
                <p className="font-medium text-gray-900 dark:text-white">
                  {formatThaiDate(d.business_date)}
                  {d.shift_label && <span className="ml-1 text-gray-400">· {d.shift_label}</span>}
                </p>
                <p className="text-gray-500 dark:text-gray-400">
                  เช็คอิน {formatThaiDateTime(d.in_ts)} · ไม่มีเช็คเอาท์
                </p>
              </div>
              {d.existing_request ? (
                <StatusBadge
                  tone={d.existing_request.status === 'approved' ? 'good' : 'warn'}
                  label={d.existing_request.status === 'approved' ? 'อนุมัติแล้ว' : 'ส่งแล้ว รออนุมัติ'}
                />
              ) : (
                <Button size="sm" onClick={() => fileForOpenDay(d)}>
                  แจ้งลืมเช็คเอาท์
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* File form */}
      <div id="att-req-form" className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{t('fileHeading')}</h2>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col text-xs font-medium text-gray-600 dark:text-gray-400">
            {t('businessDate')}
            <input
              type="date"
              value={businessDate}
              onChange={(e) => setBusinessDate(e.target.value)}
              className="control mt-1"
            />
          </label>
          <label className="flex flex-col text-xs font-medium text-gray-600 dark:text-gray-400">
            {t('kind')}
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as Kind)}
              className="control mt-1"
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {kindLabel(k)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {needsPunchFields && (
          <label className="flex flex-col text-xs font-medium text-gray-600 dark:text-gray-400">
            {t('proposedType')}
            <select
              value={proposedType}
              onChange={(e) => setProposedType(e.target.value as PunchType)}
              className="control mt-1"
            >
              {PUNCH_TYPES.map((pt) => (
                <option key={pt} value={pt}>
                  {typeLabel(pt)}
                </option>
              ))}
            </select>
          </label>
        )}

        {kind === 'wrong_time' && (
          <label className="flex flex-col text-xs font-medium text-gray-600 dark:text-gray-400">
            {t('targetPunch')}
            <select
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              className="control mt-1"
            >
              <option value="">{t('selectPunch')}</option>
              {punches.map((p) => (
                <option key={p.id} value={p.id}>
                  {typeLabel(p.type)} · {formatThaiDateTime(p.ts)}
                </option>
              ))}
            </select>
            {businessDate && punches.length === 0 && (
              <span className="mt-1 text-[11px] text-gray-400">{t('noPunchesThatDay')}</span>
            )}
          </label>
        )}

        {needsTs && (
          <label className="flex flex-col text-xs font-medium text-gray-600 dark:text-gray-400">
            {t('proposedTime')}
            <input
              type="datetime-local"
              value={proposedTs}
              onChange={(e) => setProposedTs(e.target.value)}
              className="control mt-1"
            />
          </label>
        )}

        <label className="flex flex-col text-xs font-medium text-gray-600 dark:text-gray-400">
          {t('reason')}
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="control mt-1"
          />
        </label>

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

      {/* My requests */}
      <div>
        <h2 className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">
          {t('myRequestsHeading')}
        </h2>
        {loading ? (
          <div className="flex items-center justify-center py-10 text-gray-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-400 dark:border-gray-700">
            <CalendarClock className="h-8 w-8" />
            {t('noRequests')}
          </div>
        ) : (
          <DataList compact={view === 'compact'}>
            {rows.map((r) => (
              <DataCard
                key={r.id}
                accent={STATUS_TONE[r.status]}
                title={`${formatThaiDate(r.business_date)} · ${kindLabel(r.kind)}`}
                status={
                  <>
                    <StatusBadge tone={STATUS_TONE[r.status]} label={statusLabel(r.status)} />
                    {r.status === 'approved' && (
                      <StatusBadge
                        tone={r.applied ? 'good' : 'warn'}
                        label={r.applied ? t('applied') : t('notApplied')}
                      />
                    )}
                  </>
                }
                actions={
                  r.status === 'pending' ? (
                    <Button variant="outline" size="sm" onClick={() => cancel(r.id)}>
                      {t('cancel')}
                    </Button>
                  ) : undefined
                }
              >
                <span className="block">{r.reason}</span>
                {r.decision_note && (
                  <span className="mt-1 block text-gray-400">{r.decision_note}</span>
                )}
              </DataCard>
            ))}
          </DataList>
        )}
      </div>
    </div>
  );
}
