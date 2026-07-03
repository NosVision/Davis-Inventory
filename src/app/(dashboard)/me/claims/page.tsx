'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, ReceiptText, Send } from 'lucide-react';
import { Button, Badge, toast } from '@/components/ui';
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

const STATUS_VARIANT: Record<Status, 'warning' | 'success' | 'danger' | 'info' | 'default'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  paid: 'info',
  cancelled: 'default',
};

const inputCls =
  'mt-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-white';

// Format satang (integer) into a ฿ baht string with 2 decimals.
function formatBaht(satang: number): string {
  return `฿${(satang / 100).toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

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
      if (!window.confirm(t('confirmCancel'))) return;
      try {
        const res = await fetch(`/api/hr/ess/claims/${id}/cancel`, { method: 'POST' });
        if (!res.ok) throw new Error();
        toast({ type: 'success', title: t('cancelled') });
        await fetchRows();
      } catch {
        toast({ type: 'error', title: t('actionFailed') });
      }
    },
    [t, fetchRows]
  );

  return (
    <div className="mx-auto max-w-lg space-y-4 p-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">{t('title')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('mySubtitle')}</p>
      </div>

      {/* File form */}
      <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{t('fileHeading')}</h2>

        <label className="flex flex-col text-xs font-medium text-gray-600 dark:text-gray-400">
          {t('claimType')}
          <select
            value={claimType}
            onChange={(e) => setClaimType(e.target.value as ClaimType)}
            className={inputCls}
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
              className={inputCls}
            />
          </label>
          <label className="flex flex-col text-xs font-medium text-gray-600 dark:text-gray-400">
            {t('claimDate')}
            <input
              type="date"
              value={claimDate}
              max={today}
              onChange={(e) => setClaimDate(e.target.value)}
              className={inputCls}
            />
          </label>
        </div>

        <label className="flex flex-col text-xs font-medium text-gray-600 dark:text-gray-400">
          {t('description')}
          <textarea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={inputCls}
          />
        </label>

        <label className="flex flex-col text-xs font-medium text-gray-600 dark:text-gray-400">
          {t('receiptLabel')}
          <input
            type="file"
            accept="image/*,application/pdf"
            onChange={(e) => setReceipt(e.target.files?.[0] ?? null)}
            className={`${inputCls} file:mr-3 file:rounded-md file:border-0 file:bg-indigo-50 file:px-3 file:py-1 file:text-xs file:font-medium file:text-indigo-600 dark:file:bg-indigo-900/40 dark:file:text-indigo-300`}
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
        <h2 className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">
          {t('myClaimsHeading')}
        </h2>
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
          <ul className="space-y-2">
            {rows.map((r) => (
              <li
                key={r.id}
                className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      {typeLabel(r.claim_type)}
                      {' · '}
                      {formatBaht(r.amount_satang)}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{r.claim_date}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{r.description}</p>
                    {r.decision_note && (
                      <p className="text-xs text-gray-400">{r.decision_note}</p>
                    )}
                  </div>
                  <Badge variant={STATUS_VARIANT[r.status]} size="sm">
                    {statusLabel(r.status)}
                  </Badge>
                </div>
                {r.status === 'pending' && (
                  <div className="mt-2 flex justify-end">
                    <Button variant="outline" size="sm" onClick={() => cancel(r.id)}>
                      {t('cancel')}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
