'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Inbox, ReceiptText, Printer } from 'lucide-react';
import { Button, Badge, Select, toast } from '@/components/ui';

interface StoreOpt {
  id: string;
  store_code: string;
  store_name: string;
}

type ClaimType = 'travel' | 'medical' | 'supplies' | 'equipment' | 'other';
type Status = 'pending' | 'approved' | 'rejected' | 'paid' | 'cancelled';

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
  claimant: { id: string; display_name: string | null; username: string | null } | null;
}

const STATUS_VARIANT: Record<Status, 'warning' | 'success' | 'danger' | 'info' | 'default'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  paid: 'info',
  cancelled: 'default',
};
const STATUS_FILTERS = ['all', 'pending', 'approved', 'rejected', 'paid', 'cancelled'] as const;

const inputCls =
  'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-white';

// Format satang (integer) into a ฿ baht string with 2 decimals.
function formatBaht(satang: number): string {
  return `฿${(satang / 100).toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function HrClaimsPage() {
  const t = useTranslations('hr.claims');

  const [stores, setStores] = useState<StoreOpt[]>([]);
  const [storeId, setStoreId] = useState(''); // '' = all stores (no store_id)
  const [status, setStatus] = useState<string>('pending');

  const [rows, setRows] = useState<ClaimRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [receiptLoadingId, setReceiptLoadingId] = useState<string | null>(null);

  const claimantName = (r: ClaimRow) =>
    r.claimant?.display_name ?? r.claimant?.username ?? '—';
  const typeLabel = useCallback((ct: ClaimType) => t(`type_${ct}`), [t]);
  const statusLabel = useCallback((s: Status) => t(`status_${s}`), [t]);

  // manageable stores (same source as /hr/leaves and /hr/requests)
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
      if (status !== 'all') params.set('status', status);
      const qs = params.toString();
      const res = await fetch(`/api/hr/claims${qs ? `?${qs}` : ''}`);
      if (!res.ok) throw new Error();
      const json = await res.json();
      setRows((json.data ?? []) as ClaimRow[]);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
      setRejectId(null);
      setRejectNote('');
    }
  }, [storeId, status]);

  useEffect(() => {
    load();
  }, [load]);

  const decide = useCallback(
    async (id: string, decision: 'approved' | 'rejected', note?: string) => {
      try {
        const res = await fetch(`/api/hr/claims/${id}/decide`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision, note: note?.trim() || undefined }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || json?.message);
        toast({
          type: 'success',
          title: decision === 'approved' ? t('approved') : t('rejected'),
        });
        await load();
      } catch {
        toast({ type: 'error', title: t('actionFailed') });
      }
    },
    [t, load]
  );

  const viewReceipt = useCallback(
    async (id: string) => {
      setReceiptLoadingId(id);
      try {
        // Store-scoped receipt viewer: authorized to whoever may decide this claim
        // (store manager or HR), unlike the HR-only /api/hr/documents endpoint.
        const res = await fetch(`/api/hr/claims/${id}/receipt`);
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.url) throw new Error();
        window.open(json.url as string, '_blank', 'noopener,noreferrer');
      } catch {
        toast({ type: 'error', title: t('receiptLoadFailed') });
      } finally {
        setReceiptLoadingId(null);
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
      <div className="mt-2 flex flex-wrap items-center gap-2 print:hidden">
        <input
          type="text"
          value={rejectNote}
          onChange={(e) => setRejectNote(e.target.value)}
          placeholder={t('decisionNote')}
          className={`flex-1 ${inputCls}`}
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
      <div className="mt-2 flex flex-wrap justify-end gap-2 print:hidden">
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
      </div>
    ));

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">{t('hrTitle')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('hrSubtitle')}</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => window.print()}
          icon={<Printer className="h-4 w-4" />}
          className="print:hidden"
        >
          {t('print')}
        </Button>
      </div>

      {/* filters */}
      <div className="grid grid-cols-2 gap-3 print:hidden">
        <Select
          label={t('storeLabel')}
          value={storeId}
          onChange={(e) => setStoreId(e.target.value)}
          options={storeOptions}
        />
        <Select
          label={t('status')}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={statusOptions}
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-gray-400 print:hidden">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-gray-300 px-4 py-12 text-center text-sm text-gray-400 dark:border-gray-700 print:hidden">
          <Inbox className="h-8 w-8" />
          {t('noClaims')}
        </div>
      ) : (
        <ul className="space-y-2 print:hidden">
          {rows.map((r) => (
            <li
              key={r.id}
              className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    {claimantName(r)}
                    {' · '}
                    {typeLabel(r.claim_type)}
                    {' · '}
                    {formatBaht(r.amount_satang)}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{r.claim_date}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{r.description}</p>
                  {r.receipt_path && (
                    <button
                      type="button"
                      onClick={() => viewReceipt(r.id)}
                      disabled={receiptLoadingId === r.id}
                      className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline disabled:opacity-60 dark:text-indigo-400"
                    >
                      {receiptLoadingId === r.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <ReceiptText className="h-3.5 w-3.5" />
                      )}
                      {t('viewReceipt')}
                    </button>
                  )}
                  {r.decision_note && (
                    <p className="text-xs text-gray-400">{r.decision_note}</p>
                  )}
                </div>
                <Badge variant={STATUS_VARIANT[r.status]} size="sm">
                  {statusLabel(r.status)}
                </Badge>
              </div>
              {renderDecideBar(r.id, r.status)}
            </li>
          ))}
        </ul>
      )}

      {/* Print-only summary — "all documents printable" rule */}
      <div className="hidden print:block">
        <h2 className="mb-2 text-lg font-bold">{t('printTitle')}</h2>
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-black text-left">
              <th className="py-1 pr-2">{t('colClaimant')}</th>
              <th className="py-1 pr-2">{t('colType')}</th>
              <th className="py-1 pr-2">{t('colAmount')}</th>
              <th className="py-1 pr-2">{t('colDate')}</th>
              <th className="py-1 pr-2">{t('colDescription')}</th>
              <th className="py-1 pr-2">{t('colStatus')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-gray-300 align-top">
                <td className="py-1 pr-2">{claimantName(r)}</td>
                <td className="py-1 pr-2">{typeLabel(r.claim_type)}</td>
                <td className="py-1 pr-2">{formatBaht(r.amount_satang)}</td>
                <td className="py-1 pr-2">{r.claim_date}</td>
                <td className="py-1 pr-2">{r.description}</td>
                <td className="py-1 pr-2">{statusLabel(r.status)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
