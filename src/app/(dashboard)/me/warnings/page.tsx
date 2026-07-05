'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, ShieldAlert } from 'lucide-react';
import {
  Button,
  Modal,
  ModalFooter,
  EmptyState,
  PageHeader,
  ViewToggle,
  useViewMode,
  StatusBadge,
  MoneyValue,
  DataCard,
  DataList,
  type StatusTone,
  toast,
} from '@/components/ui';
import {
  SignaturePad,
  type SignaturePadHandle,
} from '@/components/ui/signature-pad';

type Level =
  | 'verbal'
  | 'deduct_25'
  | 'deduct_50'
  | 'deduct_100'
  | 'deduct_200'
  | 'amount_baht';
type Status = 'active' | 'acknowledged' | 'void';
type SignRole = 'employee' | 'manager' | 'hr';

interface Person {
  id: string;
  display_name: string | null;
  username: string | null;
}
interface Signature {
  role: SignRole;
  signed_by: string | null;
  signed_at: string | null;
}
interface Warning {
  id: string;
  level: Level;
  sc_deduct_percent: number | null;
  amount_satang: number | null;
  sc_deduct_cycles: number | null;
  reason: string;
  detail: string | null;
  issued_at: string | null;
  expires_at: string | null;
  status: Status;
  issuer: Person | null;
  signatures: Signature[];
}

const SATANG_PER_BAHT = 100;

const LEVEL_TONE: Record<Level, StatusTone> = {
  verbal: 'neutral',
  deduct_25: 'warn',
  deduct_50: 'warn',
  deduct_100: 'critical',
  deduct_200: 'critical',
  amount_baht: 'info',
};
const STATUS_TONE: Record<Status, StatusTone> = {
  active: 'warn',
  acknowledged: 'good',
  void: 'neutral',
};
const OTHER_ROLES: Exclude<SignRole, 'employee'>[] = ['manager', 'hr'];

function bahtFromSatang(satang: number): string {
  return (satang / SATANG_PER_BAHT).toLocaleString('th-TH', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}
function formatDateTime(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('th-TH');
}
function formatDate(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('th-TH');
}

export default function MyWarningsPage() {
  const t = useTranslations('hr.warnings');

  const [rows, setRows] = useState<Warning[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<Warning | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const sigRef = useRef<SignaturePadHandle | null>(null);
  const [view, setView] = useViewMode('me-warnings');

  const levelLabel = useCallback((l: Level) => t(`level_${l}`), [t]);
  const statusLabel = useCallback((s: Status) => t(`status_${s}`), [t]);
  const roleLabel = useCallback((r: SignRole) => t(`role_${r}`), [t]);

  const scEffect = useCallback(
    (w: Warning): string => {
      if (w.level === 'verbal') return t('effect_verbal');
      const cycles = w.sc_deduct_cycles && w.sc_deduct_cycles > 1 ? ` ${t('cycles', { n: w.sc_deduct_cycles })}` : '';
      if (w.level === 'amount_baht' && w.amount_satang != null) {
        return `฿${bahtFromSatang(w.amount_satang)}${cycles}`;
      }
      if (w.sc_deduct_percent != null) return `${w.sc_deduct_percent}%${cycles}`;
      return '—';
    },
    [t]
  );

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/hr/ess/warnings');
      if (!res.ok) throw new Error();
      const json = await res.json();
      setRows((json.data ?? []) as Warning[]);
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

  const hasEmployeeSigned = (w: Warning) => w.signatures.some((s) => s.role === 'employee');

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
      const res = await fetch(`/api/hr/ess/warnings/${active.id}/ack`, {
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
        actions={<ViewToggle value={view} onChange={setView} />}
      />

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon={ShieldAlert} title={t('noWarnings')} />
      ) : (
        <DataList compact={view === 'compact'}>
          {rows.map((w) => {
            const signed = hasEmployeeSigned(w);
            return (
              <DataCard
                key={w.id}
                accent={w.status === 'void' ? 'neutral' : w.status === 'acknowledged' ? 'good' : 'warn'}
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={LEVEL_TONE[w.level]} label={levelLabel(w.level)} />
                    <span className="text-sm font-normal text-gray-500 dark:text-gray-400">
                      {t('scEffect')}: {scEffect(w)}
                    </span>
                  </span>
                }
                status={<StatusBadge tone={STATUS_TONE[w.status]} label={statusLabel(w.status)} />}
                value={
                  w.level === 'amount_baht' && w.amount_satang != null ? (
                    <MoneyValue satang={w.amount_satang} emphasis="strong" tone="critical" />
                  ) : undefined
                }
                actions={
                  !signed && w.status !== 'void' ? (
                    <Button size="sm" onClick={() => setActive(w)}>
                      {t('acknowledge')}
                    </Button>
                  ) : undefined
                }
              >
                <div className="space-y-1">
                  <p className="text-sm text-gray-800 dark:text-gray-200">{w.reason}</p>
                  {w.detail && <p className="text-gray-500 dark:text-gray-400">{w.detail}</p>}
                  <p className="text-[11px] text-gray-400">
                    {t('issuedBy')}: {w.issuer?.display_name ?? w.issuer?.username ?? '—'}
                    {' · '}
                    {t('issuedAt')}: {formatDateTime(w.issued_at)}
                    {w.expires_at && ` · ${t('expiresAt')}: ${formatDate(w.expires_at)}`}
                  </p>
                  {/* signature status */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <SignChip label={roleLabel('employee')} done={signed} />
                    {OTHER_ROLES.map((role) => (
                      <SignChip
                        key={role}
                        label={roleLabel(role)}
                        done={w.signatures.some((s) => s.role === role)}
                      />
                    ))}
                  </div>
                </div>
              </DataCard>
            );
          })}
        </DataList>
      )}

      {/* Acknowledge modal */}
      <Modal
        isOpen={active !== null}
        onClose={closeModal}
        title={t('ackTitle')}
        description={active ? `${levelLabel(active.level)} · ${scEffect(active)}` : undefined}
        size="lg"
      >
        {active && (
          <div className="space-y-4">
            <div className="space-y-1 text-sm">
              <p className="text-gray-800 dark:text-gray-200">{active.reason}</p>
              {active.detail && (
                <p className="text-xs text-gray-500 dark:text-gray-400">{active.detail}</p>
              )}
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
