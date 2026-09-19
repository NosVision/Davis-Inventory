'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Inbox, Lock } from 'lucide-react';
import { Button, Select, PageHeader, DataList, DataCard, StatusBadge, SkeletonList, ViewToggle, useViewMode, toast } from '@/components/ui';
import { EmployeeName } from '@/components/hr/employee-name';
import { useEssText } from '@/lib/i18n/ess-locale';

type Status = 'pending' | 'approved' | 'rejected' | 'cancelled';
type FieldKey = 'bank_account' | 'emergency_contact' | 'full_name';

interface ChangeRequest {
  id: string;
  field_key: FieldKey;
  current_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  reason: string | null;
  status: Status;
  decision_note: string | null;
  decided_at: string | null;
  created_at: string;
  requester: { id: string; full_name: string | null; display_name: string | null; username: string | null } | null;
  /** Set by the API when THIS caller may not see the requester's pay: bank values come back blanked
   *  and the decide route refuses, so the card shows a lock instead of the diff and the buttons. */
  pay_hidden?: boolean;
}

const STATUS_TONE: Record<Status, 'warn' | 'good' | 'critical' | 'neutral'> = {
  pending: 'warn',
  approved: 'good',
  rejected: 'critical',
  cancelled: 'neutral',
};
const STATUS_FILTERS = ['pending', 'approved', 'rejected', 'cancelled', 'all'] as const;

const KNOWN_KEYS = [
  'bank_name',
  'bank_account_no',
  'bank_account_name',
  'name',
  'phone',
  'relation',
] as const;

export default function HrProfileRequestsPage() {
  const t = useTranslations('hr.profile');
  const tx = useEssText();
  const fullNameLabel = tx('ชื่อ-นามสกุล', 'Full name', 'အမည်အပြည့်အစုံ', 'ຊື່-ນາມສະກຸນ');
  const payHiddenNote = tx(
    'ปิดข้อมูลเงินเดือน — คุณไม่มีสิทธิ์ดูบัญชีธนาคารของคนนี้ คำขอนี้รอผู้ที่ดูเงินเดือนของคนนี้ได้เป็นผู้พิจารณา',
    'Pay is confidential — you may not see this person\'s bank account. This request waits for someone who can.'
  );

  const [status, setStatus] = useState<string>('pending');
  const [view, setView] = useViewMode('hr-profile-requests');
  const [rows, setRows] = useState<ChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState('');

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

  const fieldLabel = useCallback(
    (f: FieldKey) =>
      f === 'bank_account' ? t('fieldBankAccount')
      : f === 'full_name' ? fullNameLabel
      : t('fieldEmergencyContact'),
    [t, fullNameLabel]
  );

  const keyLabel = useCallback(
    (k: string) =>
      k === 'full_name' ? fullNameLabel
      : (KNOWN_KEYS as readonly string[]).includes(k) ? t(`key_${k}` as never)
      : k,
    [t, fullNameLabel]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = status !== 'all' ? `?status=${status}` : '';
      const res = await fetch(`/api/hr/profile-change-requests${qs}`);
      if (!res.ok) throw new Error();
      const json = await res.json();
      setRows((json.data ?? []) as ChangeRequest[]);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
      setRejectId(null);
      setRejectNote('');
    }
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  const decide = useCallback(
    async (id: string, decision: 'approved' | 'rejected', note?: string) => {
      try {
        const res = await fetch(`/api/hr/profile-change-requests/${id}/decide`, {
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
        // Decision may have succeeded while applying to the employee record failed.
        if (json?.warning) toast({ type: 'warning', title: t('applyWarning') });
        await load();
      } catch {
        toast({ type: 'error', title: t('actionFailed') });
      }
    },
    [t, load]
  );

  const statusOptions = STATUS_FILTERS.map((s) => ({
    value: s,
    label: s === 'all' ? t('statusAll') : statusLabel(s as Status),
  }));

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <PageHeader
        title={t('hrTitle')}
        subtitle={t('hrSubtitle')}
        actions={<ViewToggle value={view} onChange={setView} />}
      />

      <div className="max-w-xs">
        <Select
          label={t('status')}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={statusOptions}
        />
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
              title={<EmployeeName source={r.requester} />}
              subtitle={fieldLabel(r.field_key)}
              status={<StatusBadge tone={STATUS_TONE[r.status]} label={statusLabel(r.status)} />}
              actions={
                // The decide route answers 403 for a hidden requester, so the buttons would only
                // produce an error toast — the lock note in the body says who has to act instead.
                r.status === 'pending' && !r.pay_hidden ? (
                  rejectId === r.id ? (
                    <div className="flex w-full flex-wrap items-center gap-2">
                      <input
                        type="text"
                        value={rejectNote}
                        onChange={(e) => setRejectNote(e.target.value)}
                        placeholder={t('decisionNote')}
                        className="control flex-1"
                      />
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => decide(r.id, 'rejected', rejectNote)}
                      >
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
                          setRejectId(r.id);
                          setRejectNote('');
                        }}
                      >
                        {t('reject')}
                      </Button>
                      <Button size="sm" onClick={() => decide(r.id, 'approved')}>
                        {t('approve')}
                      </Button>
                    </>
                  )
                ) : undefined
              }
            >
              <div className="mt-1">
                {r.pay_hidden ? (
                  <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 p-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                    <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{payHiddenNote}</span>
                  </p>
                ) : (
                  <ValueDiff
                    current={r.current_value}
                    next={r.new_value}
                    keyLabel={keyLabel}
                    currentLabel={t('currentLabel')}
                    newLabel={t('newLabel')}
                    emptyLabel={t('emptyValue')}
                  />
                )}
              </div>

              {r.reason && (
                <p className="mt-2">
                  {t('reason')}: {r.reason}
                </p>
              )}
              {r.decision_note && (
                <p className="mt-1 text-gray-400">
                  {t('decisionNote')}: {r.decision_note}
                </p>
              )}
            </DataCard>
          ))}
        </DataList>
      )}
    </div>
  );
}

// Generic current→new diff. Iterates the union of both objects' keys so it works
// for any field type (bank account, emergency contact, and future ones).
function ValueDiff({
  current,
  next,
  keyLabel,
  currentLabel,
  newLabel,
  emptyLabel,
}: {
  current: Record<string, unknown> | null;
  next: Record<string, unknown> | null;
  keyLabel: (k: string) => string;
  currentLabel: string;
  newLabel: string;
  emptyLabel: string;
}) {
  const keys = Array.from(
    new Set([...Object.keys(current ?? {}), ...Object.keys(next ?? {})])
  );
  const fmt = (v: unknown) =>
    v === null || v === undefined || v === '' ? emptyLabel : String(v);

  return (
    <div className="grid grid-cols-2 gap-2 text-xs">
      <div className="rounded-lg bg-gray-50 p-2 dark:bg-gray-900/40">
        <p className="mb-1 text-[10px] font-semibold uppercase text-gray-400">{currentLabel}</p>
        {keys.map((k) => (
          <p key={k} className="text-gray-500 dark:text-gray-400">
            <span className="text-gray-400">{keyLabel(k)}:</span> {fmt((current ?? {})[k])}
          </p>
        ))}
      </div>
      <div className="rounded-lg bg-indigo-50 p-2 dark:bg-indigo-900/20">
        <p className="mb-1 text-[10px] font-semibold uppercase text-indigo-400">{newLabel}</p>
        {keys.map((k) => (
          <p key={k} className="text-gray-700 dark:text-gray-200">
            <span className="text-gray-400">{keyLabel(k)}:</span> {fmt((next ?? {})[k])}
          </p>
        ))}
      </div>
    </div>
  );
}
