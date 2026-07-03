'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, DoorOpen } from 'lucide-react';
import { Button, Badge, Modal, ModalFooter, EmptyState, toast } from '@/components/ui';
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

const KIND_BADGE: Record<Kind, 'default' | 'danger'> = {
  resignation: 'default',
  termination: 'danger',
};
const STATUS_BADGE: Record<Status, 'warning' | 'info' | 'success' | 'default'> = {
  draft: 'warning',
  pending_signoff: 'info',
  completed: 'success',
  cancelled: 'default',
};
const RESOLUTION_BADGE: Record<Resolution, 'warning' | 'success' | 'danger'> = {
  pending: 'warning',
  returned: 'success',
  lost: 'danger',
  damaged: 'danger',
};

function formatDate(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString('th-TH');
}

export default function MyOffboardingPage() {
  const t = useTranslations('hr.offboarding');

  const [rows, setRows] = useState<Offboarding[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<Offboarding | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const sigRef = useRef<SignaturePadHandle | null>(null);

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

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

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
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">{t('myTitle')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('mySubtitle')}</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon={DoorOpen} title={t('myEmpty')} description={t('myEmptyHint')} />
      ) : (
        <ul className="space-y-3">
          {rows.map((o) => (
            <li
              key={o.id}
              className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={KIND_BADGE[o.kind]} size="sm">
                      {kindLabel(o.kind)}
                    </Badge>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {t('noticeDate')}: {formatDate(o.notice_date)}
                    {' · '}
                    {t('lastWorkingDate')}: {formatDate(o.last_working_date)}
                  </p>
                  {o.reason && (
                    <p className="text-sm text-gray-700 dark:text-gray-300">{o.reason}</p>
                  )}
                </div>
                <Badge variant={STATUS_BADGE[o.status]} size="sm">
                  {statusLabel(o.status)}
                </Badge>
              </div>

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
                        <Badge variant={RESOLUTION_BADGE[a.resolution]} size="sm">
                          {resolutionLabel(a.resolution)}
                        </Badge>
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

              {canAck(o) && (
                <div className="mt-3 flex justify-end">
                  <Button size="sm" onClick={() => setActive(o)}>
                    {t('acknowledge')}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
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
                  <Badge variant={RESOLUTION_BADGE[a.resolution]} size="sm">
                    {resolutionLabel(a.resolution)}
                  </Badge>
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
