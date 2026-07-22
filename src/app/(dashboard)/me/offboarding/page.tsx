'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { formatThaiDate } from '@/lib/utils/format';
import { todayBangkok } from '@/lib/utils/date';
import { Loader2, DoorOpen, Send, Undo2 } from 'lucide-react';
import {
  Button,
  Modal,
  ModalFooter,
  EmptyState,
  toast,
  PageHeader,
  ViewToggle,
  useViewMode,
  StatusBadge,
  DataCard,
  DataList,
  type StatusTone,
} from '@/components/ui';
import {
  SignaturePad,
  type SignaturePadHandle,
} from '@/components/ui/signature-pad';

// ── Types (per P3.4b ESS API contract) ──────────────────────────────────────
type Kind = 'resignation' | 'termination';
type Status = 'draft' | 'pending_signoff' | 'completed' | 'cancelled';
type Resolution = 'pending' | 'returned' | 'lost' | 'damaged';

interface AssetItem {
  id: string;
  asset_id: string;
  asset_code: string | null;
  asset_name: string | null;
  resolution: Resolution;
  note: string | null;
}
interface Offboarding {
  id: string;
  kind: Kind;
  reason: string | null;
  notice_date: string | null;
  last_working_date: string | null;
  status: Status;
  employee_signed_at: string | null;
  hr_signed_at: string | null;
  assets: AssetItem[];
}

type RequestStatus = 'pending' | 'accepted' | 'rejected' | 'withdrawn';
interface ResignationRequest {
  id: string;
  notice_date: string;
  last_working_date: string | null;
  reason: string | null;
  status: RequestStatus;
  review_note: string | null;
  created_at: string | null;
}

const KIND_TONE: Record<Kind, StatusTone> = {
  resignation: 'neutral',
  termination: 'critical',
};
const STATUS_TONE: Record<Status, StatusTone> = {
  draft: 'warn',
  pending_signoff: 'info',
  completed: 'good',
  cancelled: 'neutral',
};
const STATUS_ACCENT: Record<Status, 'neutral' | 'accent' | 'good' | 'warn'> = {
  draft: 'warn',
  pending_signoff: 'accent',
  completed: 'good',
  cancelled: 'neutral',
};
const RESOLUTION_TONE: Record<Resolution, StatusTone> = {
  pending: 'warn',
  returned: 'good',
  lost: 'critical',
  damaged: 'critical',
};
const REQUEST_TONE: Record<RequestStatus, StatusTone> = {
  pending: 'warn',
  accepted: 'good',
  rejected: 'critical',
  withdrawn: 'neutral',
};

const inputCls = 'control mt-1 w-full disabled:cursor-not-allowed disabled:opacity-60';

function formatDate(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : formatThaiDate(d);
}

export default function MyOffboardingPage() {
  const t = useTranslations('hr.offboarding');

  const [rows, setRows] = useState<Offboarding[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<Offboarding | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const sigRef = useRef<SignaturePadHandle | null>(null);
  const [view, setView] = useViewMode('me-offboarding');

  // resignation requests (ยื่นใบลาออก)
  const [requests, setRequests] = useState<ResignationRequest[]>([]);
  const [resignOpen, setResignOpen] = useState(false);
  const [resignSubmitting, setResignSubmitting] = useState(false);
  const [resignLastDate, setResignLastDate] = useState('');
  const [resignReason, setResignReason] = useState('');
  const resignSigRef = useRef<SignaturePadHandle | null>(null);
  const [withdrawFor, setWithdrawFor] = useState<ResignationRequest | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);

  const kindLabel = useCallback((k: Kind) => t(`kind_${k}`), [t]);
  const statusLabel = useCallback((s: Status) => t(`status_${s}`), [t]);
  const resolutionLabel = useCallback((r: Resolution) => t(`resolution_${r}`), [t]);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/hr/ess/offboarding');
      if (!res.ok) throw new Error();
      const json = await res.json();
      setRows((json.data ?? []) as Offboarding[]);
    } catch {
      toast({ type: 'error', title: t('loadFailed') });
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [t]);

  const fetchRequests = useCallback(async () => {
    try {
      const res = await fetch('/api/hr/ess/resignation');
      if (!res.ok) throw new Error();
      const json = await res.json();
      setRequests((json.data ?? []) as ResignationRequest[]);
    } catch {
      setRequests([]);
    }
  }, []);

  useEffect(() => {
    fetchRows();
    fetchRequests();
  }, [fetchRows, fetchRequests]);

  // ── Submit a resignation request ──────────────────────────────────────────
  const hasPendingRequest = useMemo(
    () => requests.some((r) => r.status === 'pending'),
    [requests]
  );
  const hasOpenOffboarding = useMemo(
    () => rows.some((o) => o.status === 'draft' || o.status === 'pending_signoff'),
    [rows]
  );
  const canResign = !loading && !hasPendingRequest && !hasOpenOffboarding;

  const openResign = useCallback(() => {
    setResignLastDate('');
    setResignReason('');
    setResignOpen(true);
  }, []);

  const submitResign = useCallback(async () => {
    const pad = resignSigRef.current;
    if (!pad || pad.isEmpty()) {
      toast({ type: 'warning', title: t('signRequired') });
      return;
    }
    const signature = pad.toDataURL();
    if (!signature) {
      toast({ type: 'warning', title: t('signRequired') });
      return;
    }
    setResignSubmitting(true);
    try {
      const res = await fetch('/api/hr/ess/resignation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          last_working_date: resignLastDate || undefined,
          reason: resignReason.trim() || undefined,
          signature,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 409) {
        toast({ type: 'warning', title: t('resignAlreadyPending') });
        setResignOpen(false);
        await Promise.all([fetchRows(), fetchRequests()]);
        return;
      }
      if (!res.ok) throw new Error(json?.error);
      toast({ type: 'success', title: t('resignSubmitted') });
      setResignOpen(false);
      await fetchRequests();
    } catch (e) {
      toast({
        type: 'error',
        title: e instanceof Error && e.message ? e.message : t('resignSubmitFailed'),
      });
    } finally {
      setResignSubmitting(false);
    }
  }, [resignLastDate, resignReason, t, fetchRows, fetchRequests]);

  const submitWithdraw = useCallback(async () => {
    if (!withdrawFor) return;
    setWithdrawing(true);
    try {
      const res = await fetch(`/api/hr/ess/resignation/${withdrawFor.id}/withdraw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.status === 409) {
        toast({ type: 'warning', title: t('withdrawConflict') });
        setWithdrawFor(null);
        await fetchRequests();
        return;
      }
      if (!res.ok) throw new Error();
      toast({ type: 'success', title: t('withdrawnOk') });
      setWithdrawFor(null);
      await fetchRequests();
    } catch {
      toast({ type: 'error', title: t('withdrawFailed') });
    } finally {
      setWithdrawing(false);
    }
  }, [withdrawFor, t, fetchRequests]);

  const canAck = (o: Offboarding) =>
    o.status !== 'completed' && o.status !== 'cancelled' && !o.employee_signed_at;

  const closeModal = useCallback(() => {
    setActive(null);
    setSubmitting(false);
  }, []);

  const submitAck = useCallback(async () => {
    if (!active) return;
    const pad = sigRef.current;
    if (!pad || pad.isEmpty()) {
      toast({ type: 'warning', title: t('signRequired') });
      return;
    }
    const signature = pad.toDataURL();
    if (!signature) {
      toast({ type: 'warning', title: t('signRequired') });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/hr/ess/offboarding/${active.id}/ack`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signature }),
      });
      if (res.status === 409) {
        toast({ type: 'warning', title: t('alreadyAcked') });
        closeModal();
        await fetchRows();
        return;
      }
      if (!res.ok) throw new Error();
      toast({ type: 'success', title: t('acknowledgedOk') });
      closeModal();
      await fetchRows();
    } catch {
      toast({ type: 'error', title: t('ackFailed') });
      setSubmitting(false);
    }
  }, [active, t, closeModal, fetchRows]);

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <PageHeader
        title={t('myTitle')}
        subtitle={t('mySubtitle')}
        actions={
          <>
            <ViewToggle value={view} onChange={setView} />
            {canResign && (
              <Button size="sm" onClick={openResign} icon={<Send className="h-4 w-4" />}>
                {t('submitResignation')}
              </Button>
            )}
          </>
        }
      />

      {/* My resignation requests */}
      {requests.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            {t('myRequestsHeading')}
          </h2>
          <DataList compact={view === 'compact'}>
            {requests.map((r) => (
              <DataCard
                key={r.id}
                accent={r.status === 'pending' ? 'warn' : r.status === 'accepted' ? 'good' : 'neutral'}
                title={
                  <StatusBadge tone={REQUEST_TONE[r.status]} label={t(`reqStatus_${r.status}`)} />
                }
                actions={
                  r.status === 'pending' ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setWithdrawFor(r)}
                      icon={<Undo2 className="h-3.5 w-3.5" />}
                    >
                      {t('withdraw')}
                    </Button>
                  ) : undefined
                }
              >
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t('noticeDate')}: {formatDate(r.notice_date)}
                  {' · '}
                  {t('desiredLastDate')}: {formatDate(r.last_working_date)}
                </p>
                {r.reason && (
                  <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">{r.reason}</p>
                )}
                {r.review_note && (
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {t('reviewNote')}: {r.review_note}
                  </p>
                )}
              </DataCard>
            ))}
          </DataList>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon={DoorOpen} title={t('myEmpty')} description={t('myEmptyHint')} />
      ) : (
        <DataList compact={view === 'compact'}>
          {rows.map((o) => (
            <DataCard
              key={o.id}
              accent={STATUS_ACCENT[o.status]}
              title={<StatusBadge tone={KIND_TONE[o.kind]} label={kindLabel(o.kind)} />}
              status={<StatusBadge tone={STATUS_TONE[o.status]} label={statusLabel(o.status)} />}
              actions={
                canAck(o) ? (
                  <Button size="sm" onClick={() => setActive(o)}>
                    {t('acknowledge')}
                  </Button>
                ) : undefined
              }
            >
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t('noticeDate')}: {formatDate(o.notice_date)}
                {' · '}
                {t('lastWorkingDate')}: {formatDate(o.last_working_date)}
              </p>
              {o.reason && (
                <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">{o.reason}</p>
              )}

              {/* asset checklist (read-only) */}
              <div className="mt-3 space-y-2">
                <h3 className="text-xs font-semibold text-gray-600 dark:text-gray-400">
                  {t('assetChecklist')}
                </h3>
                {o.assets.length === 0 ? (
                  <p className="text-xs text-gray-400">{t('noAssets')}</p>
                ) : (
                  <ul className="space-y-1.5">
                    {o.assets.map((a) => (
                      <li
                        key={a.id}
                        className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 px-2.5 py-1.5 dark:border-gray-700"
                      >
                        <div className="min-w-0">
                          <span className="text-sm text-gray-800 dark:text-gray-200">
                            {a.asset_name || '—'}
                          </span>
                          <span className="ml-1 text-xs text-gray-400">{a.asset_code || ''}</span>
                          {a.note && (
                            <span className="ml-1 text-xs text-gray-400">· {a.note}</span>
                          )}
                        </div>
                        <StatusBadge
                          tone={RESOLUTION_TONE[a.resolution]}
                          label={resolutionLabel(a.resolution)}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* signature status */}
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <SignChip label={t('empSigned')} done={Boolean(o.employee_signed_at)} />
                <SignChip label={t('hrSigned')} done={Boolean(o.hr_signed_at)} />
              </div>
            </DataCard>
          ))}
        </DataList>
      )}

      {/* Acknowledge modal */}
      <Modal
        isOpen={active !== null}
        onClose={closeModal}
        title={t('ackTitle')}
        description={active ? kindLabel(active.kind) : undefined}
        size="lg"
      >
        {active && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">{t('ackIntro')}</p>
            <div className="space-y-1.5">
              {active.assets.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 px-2.5 py-1.5 dark:border-gray-700"
                >
                  <span className="text-sm text-gray-800 dark:text-gray-200">
                    {a.asset_name || '—'}
                    <span className="ml-1 text-xs text-gray-400">{a.asset_code || ''}</span>
                  </span>
                  <StatusBadge
                    tone={RESOLUTION_TONE[a.resolution]}
                    label={resolutionLabel(a.resolution)}
                  />

                </div>
              ))}
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('ackPrompt')}</p>
              <SignaturePad ref={sigRef} />
            </div>
          </div>
        )}
        <ModalFooter>
          <Button variant="ghost" size="sm" onClick={() => sigRef.current?.clear()} disabled={submitting}>
            {t('clear')}
          </Button>
          <Button size="sm" onClick={submitAck} isLoading={submitting}>
            {t('acknowledge')}
          </Button>
        </ModalFooter>
      </Modal>

      {/* Submit resignation modal */}
      <Modal
        isOpen={resignOpen}
        onClose={() => !resignSubmitting && setResignOpen(false)}
        title={t('resignFormTitle')}
        size="lg"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">{t('resignIntro')}</p>

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('noticeDate')}
              <input type="date" value={todayBangkok()} disabled className={inputCls} />
            </label>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('desiredLastDate')}
              <input
                type="date"
                value={resignLastDate}
                min={todayBangkok()}
                onChange={(e) => setResignLastDate(e.target.value)}
                className={inputCls}
              />
            </label>
          </div>

          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('reason')}
            <textarea
              rows={2}
              value={resignReason}
              onChange={(e) => setResignReason(e.target.value)}
              placeholder={t('reasonPlaceholder')}
              className={inputCls}
            />
          </label>

          <div className="space-y-2">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('resignSignPrompt')}
            </p>
            <SignaturePad ref={resignSigRef} />
          </div>
        </div>
        <ModalFooter>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => resignSigRef.current?.clear()}
            disabled={resignSubmitting}
          >
            {t('clear')}
          </Button>
          <Button size="sm" onClick={submitResign} isLoading={resignSubmitting}>
            {t('submitResignation')}
          </Button>
        </ModalFooter>
      </Modal>

      {/* Withdraw confirm modal */}
      <Modal
        isOpen={withdrawFor !== null}
        onClose={() => !withdrawing && setWithdrawFor(null)}
        title={t('withdrawTitle')}
        size="md"
      >
        <p className="text-sm text-gray-600 dark:text-gray-400">{t('withdrawPrompt')}</p>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setWithdrawFor(null)} disabled={withdrawing}>
            {t('keep')}
          </Button>
          <Button variant="danger" onClick={submitWithdraw} isLoading={withdrawing}>
            {t('withdraw')}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}

function SignChip({ label, done }: { label: string; done: boolean }) {
  return (
    <span
      className={
        done
          ? 'inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
          : 'inline-flex items-center gap-1 rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-[10px] font-medium text-gray-400 dark:border-gray-600'
      }
    >
      {done ? '✓' : '○'} {label}
    </span>
  );
}
