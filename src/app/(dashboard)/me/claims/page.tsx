'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, ReceiptText, Send } from 'lucide-react';
import {
  Button,
  PageHeader,
  SectionHeading,
  StatusBadge,
  MoneyValue,
  DataCard,
  DataList,
  useConfirm,
  type StatusTone,
  toast,
} from '@/components/ui';
import { todayBangkok } from '@/lib/utils/date';

type ClaimType = 'travel' | 'medical' | 'supplies' | 'equipment' | 'other';
type Status = 'pending' | 'approved' | 'rejected' | 'paid' | 'cancelled';

const CLAIM_TYPES: readonly ClaimType[] = [
  'travel',
  'medical',
  'supplies',
  'equipment',
  'other',
] as const;

interface ClaimRow {
  id: string;
  claim_type: ClaimType;
  amount_satang: number;
  description: string;
  receipt_path: string | null;
  claim_date: string;
  status: Status;
  decision_note: string | null;
  decided_at: string | null;
  created_at: string;
}

const STATUS_TONE: Record<Status, StatusTone> = {
  pending: 'warn',
  approved: 'good',
  rejected: 'critical',
  paid: 'good',
  cancelled: 'neutral',
};
const STATUS_ACCENT: Record<Status, 'good' | 'warn' | 'critical' | 'neutral'> = {
  pending: 'warn',
  approved: 'good',
  rejected: 'critical',
  paid: 'good',
  cancelled: 'neutral',
};

// Convert a baht input string to integer satang; NaN-safe, returns 0 when invalid.
function bahtToSatang(baht: string): number {
  const n = Number(baht);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100);
}

export default function MyClaimsPage() {
  const t = useTranslations('hr.claims');

  const [rows, setRows] = useState<ClaimRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const today = todayBangkok();
  const [claimType, setClaimType] = useState<ClaimType>('travel');
  const [amount, setAmount] = useState('');
  const [claimDate, setClaimDate] = useState(today);
  const [description, setDescription] = useState('');
  const [receipt, setReceipt] = useState<File | null>(null);

  const { confirm, dialog } = useConfirm();

  const typeLabel = useCallback((ct: ClaimType) => t(`type_${ct}`), [t]);
  const statusLabel = useCallback((s: Status) => t(`status_${s}`), [t]);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/hr/ess/claims');
      if (!res.ok) throw new Error('load failed');
      const json = await res.json();
      setRows((json.data ?? []) as ClaimRow[]);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const satang = bahtToSatang(amount);
  const canSubmit =
    Boolean(claimType && claimDate && description.trim() && receipt) &&
    satang > 0 &&
    !submitting;

  const submit = useCallback(async () => {
    if (!description.trim() || satang <= 0) return;
    if (!receipt) {
      toast({ type: 'error', title: t('receiptRequired') });
      return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('claim_type', claimType);
      fd.append('amount_satang', String(satang));
      fd.append('description', description.trim());
      fd.append('claim_date', claimDate);
      fd.append('receipt', receipt);
      // NOTE: do not set Content-Type — the browser sets the multipart boundary.
      const res = await fetch('/api/hr/ess/claims', { method: 'POST', body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || json?.message || t('fileFailed'));
      toast({ type: 'success', title: t('filed') });
      setAmount('');
      setDescription('');
      setReceipt(null);
      setClaimType('travel');
      setClaimDate(today);
      await fetchRows();
    } catch (e) {
      toast({ type: 'error', title: e instanceof Error ? e.message : t('fileFailed') });
    } finally {
      setSubmitting(false);
    }
  }, [claimType, satang, description, claimDate, receipt, t, today, fetchRows]);

  const cancel = useCallback(
    async (id: string) => {
      if (!(await confirm({ title: t('confirmCancel'), tone: 'danger' }))) return;
      try {
        const res = await fetch(`/api/hr/ess/claims/${id}/cancel`, { method: 'POST' });
        if (!res.ok) throw new Error();
        toast({ type: 'success', title: t('cancelled') });
        await fetchRows();
      } catch {
        toast({ type: 'error', title: t('actionFailed') });
      }
    },
    [t, fetchRows, confirm]
  );

  return (
    <div className="mx-auto max-w-lg space-y-4 p-4">
      <PageHeader title={t('title')} subtitle={t('mySubtitle')} />

      {/* File form */}
      <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <SectionHeading title={t('fileHeading')} />

        <label className="flex flex-col text-xs font-medium text-gray-600 dark:text-gray-400">
          {t('claimType')}
          <select
            value={claimType}
            onChange={(e) => setClaimType(e.target.value as ClaimType)}
            className="control mt-1"
          >
            {CLAIM_TYPES.map((ct) => (
              <option key={ct} value={ct}>
                {typeLabel(ct)}
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col text-xs font-medium text-gray-600 dark:text-gray-400">
            {t('amount')}
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={t('amountPlaceholder')}
              className="control mt-1"
            />
          </label>
          <label className="flex flex-col text-xs font-medium text-gray-600 dark:text-gray-400">
            {t('claimDate')}
            <input
              type="date"
              value={claimDate}
              max={today}
              onChange={(e) => setClaimDate(e.target.value)}
              className="control mt-1"
            />
          </label>
        </div>

        <label className="flex flex-col text-xs font-medium text-gray-600 dark:text-gray-400">
          {t('description')}
          <textarea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="control mt-1"
          />
        </label>

        <label className="flex flex-col text-xs font-medium text-gray-600 dark:text-gray-400">
          {t('receiptLabel')}
          <input
            type="file"
            accept="image/*,application/pdf"
            onChange={(e) => setReceipt(e.target.files?.[0] ?? null)}
            className="control mt-1 file:mr-3 file:rounded-md file:border-0 file:bg-indigo-50 file:px-3 file:py-1 file:text-xs file:font-medium file:text-indigo-600 dark:file:bg-indigo-900/40 dark:file:text-indigo-300"
          />
          <span className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
            {t('receiptHint')}
          </span>
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

      {/* My claims */}
      <div>
        <SectionHeading title={t('myClaimsHeading')} className="mb-2" />
        {loading ? (
          <div className="flex items-center justify-center py-10 text-gray-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-400 dark:border-gray-700">
            <ReceiptText className="h-8 w-8" />
            {t('noClaims')}
          </div>
        ) : (
          <DataList>
            {rows.map((r) => (
              <DataCard
                key={r.id}
                accent={STATUS_ACCENT[r.status]}
                title={typeLabel(r.claim_type)}
                status={<StatusBadge tone={STATUS_TONE[r.status]} label={statusLabel(r.status)} />}
                value={<MoneyValue satang={r.amount_satang} emphasis="strong" />}
                actions={
                  r.status === 'pending' ? (
                    <Button variant="outline" size="sm" onClick={() => cancel(r.id)}>
                      {t('cancel')}
                    </Button>
                  ) : undefined
                }
              >
                <div className="space-y-1">
                  <p>{r.claim_date}</p>
                  <p className="text-gray-500 dark:text-gray-400">{r.description}</p>
                  {r.decision_note && <p className="text-gray-400">{r.decision_note}</p>}
                </div>
              </DataCard>
            ))}
          </DataList>
        )}
      </div>
      {dialog}
    </div>
  );
}
