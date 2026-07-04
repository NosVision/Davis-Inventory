'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, UserCircle, Landmark, Phone, Send, Inbox } from 'lucide-react';
import { Button, Modal, ModalFooter, PageHeader, DataList, DataCard, StatusBadge, useConfirm, toast } from '@/components/ui';

type Status = 'pending' | 'approved' | 'rejected' | 'cancelled';
type FieldKey = 'bank_account' | 'emergency_contact';

interface Profile {
  display_name: string | null;
  username: string | null;
  position: string | null;
  department: string | null;
  company: string | null;
  start_date: string | null;
  status: string | null;
  work_hours_per_day: number | null;
  bank_name: string | null;
  bank_account_no_masked: string | null;
  bank_account_name: string | null;
  emergency_contact: { name?: string; phone?: string; relation?: string } | null;
}

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
}

// Narrow union so a single map drives both the StatusBadge tone and the DataCard accent rail.
const STATUS_TONE: Record<Status, 'warn' | 'good' | 'critical' | 'neutral'> = {
  pending: 'warn',
  approved: 'good',
  rejected: 'critical',
  cancelled: 'neutral',
};

const KNOWN_KEYS = [
  'bank_name',
  'bank_account_no',
  'bank_account_name',
  'name',
  'phone',
  'relation',
] as const;

export default function MyProfilePage() {
  const t = useTranslations('hr.profile');
  const { confirm, dialog } = useConfirm();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [rows, setRows] = useState<ChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [openField, setOpenField] = useState<FieldKey | null>(null);
  const [reason, setReason] = useState('');
  // bank fields
  const [bankName, setBankName] = useState('');
  const [bankAccountNo, setBankAccountNo] = useState('');
  const [bankAccountName, setBankAccountName] = useState('');
  // emergency fields
  const [ecName, setEcName] = useState('');
  const [ecPhone, setEcPhone] = useState('');
  const [ecRelation, setEcRelation] = useState('');

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
    (f: FieldKey) => (f === 'bank_account' ? t('fieldBankAccount') : t('fieldEmergencyContact')),
    [t]
  );

  const keyLabel = useCallback(
    (k: string) =>
      (KNOWN_KEYS as readonly string[]).includes(k) ? t(`key_${k}` as never) : k,
    [t]
  );

  const loadProfile = useCallback(async () => {
    try {
      const res = await fetch('/api/hr/ess/profile');
      if (!res.ok) throw new Error('load failed');
      const json = await res.json();
      setProfile((json.data ?? null) as Profile | null);
      setErrored(false);
    } catch {
      setProfile(null);
      setErrored(true);
    }
  }, []);

  const loadRows = useCallback(async () => {
    try {
      const res = await fetch('/api/hr/ess/profile-change-requests');
      if (!res.ok) throw new Error('load failed');
      const json = await res.json();
      setRows((json.data ?? []) as ChangeRequest[]);
    } catch {
      setRows([]);
    }
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadProfile(), loadRows()]);
    setLoading(false);
  }, [loadProfile, loadRows]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const closeModal = useCallback(() => {
    setOpenField(null);
    setReason('');
    setBankName('');
    setBankAccountNo('');
    setBankAccountName('');
    setEcName('');
    setEcPhone('');
    setEcRelation('');
  }, []);

  const openBank = useCallback(() => {
    setBankName(profile?.bank_name ?? '');
    setBankAccountName(profile?.bank_account_name ?? '');
    setBankAccountNo('');
    setReason('');
    setOpenField('bank_account');
  }, [profile]);

  const openEmergency = useCallback(() => {
    setEcName(profile?.emergency_contact?.name ?? '');
    setEcPhone(profile?.emergency_contact?.phone ?? '');
    setEcRelation(profile?.emergency_contact?.relation ?? '');
    setReason('');
    setOpenField('emergency_contact');
  }, [profile]);

  const bankValid =
    Boolean(bankName.trim()) && Boolean(bankAccountNo.trim()) && Boolean(bankAccountName.trim());
  const emergencyValid = Boolean(ecName.trim()) && Boolean(ecPhone.trim());
  const canSubmit =
    !submitting && (openField === 'bank_account' ? bankValid : emergencyValid);

  const submit = useCallback(async () => {
    if (!openField || !canSubmit) return;
    const new_value =
      openField === 'bank_account'
        ? {
            bank_name: bankName.trim(),
            bank_account_no: bankAccountNo.trim(),
            bank_account_name: bankAccountName.trim(),
          }
        : {
            name: ecName.trim(),
            phone: ecPhone.trim(),
            relation: ecRelation.trim() || undefined,
          };
    setSubmitting(true);
    try {
      const res = await fetch('/api/hr/ess/profile-change-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          field_key: openField,
          new_value,
          reason: reason.trim() || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 409) {
        toast({ type: 'error', title: t('errorDuplicate') });
        return;
      }
      if (!res.ok) throw new Error(json?.error || json?.message || t('submitFailed'));
      toast({ type: 'success', title: t('submitted') });
      closeModal();
      await loadRows();
    } catch (e) {
      toast({ type: 'error', title: e instanceof Error ? e.message : t('submitFailed') });
    } finally {
      setSubmitting(false);
    }
  }, [
    openField,
    canSubmit,
    bankName,
    bankAccountNo,
    bankAccountName,
    ecName,
    ecPhone,
    ecRelation,
    reason,
    t,
    closeModal,
    loadRows,
  ]);

  const cancelRequest = useCallback(
    async (id: string) => {
      if (!(await confirm({ title: t('confirmCancel'), tone: 'danger', confirmLabel: t('cancel') }))) return;
      try {
        const res = await fetch(`/api/hr/ess/profile-change-requests/${id}/cancel`, {
          method: 'POST',
        });
        if (!res.ok) throw new Error();
        toast({ type: 'success', title: t('cancelled') });
        await loadRows();
      } catch {
        toast({ type: 'error', title: t('actionFailed') });
      }
    },
    [t, loadRows, confirm]
  );

  const emergency = profile?.emergency_contact ?? null;

  return (
    <div className="mx-auto max-w-lg space-y-4 p-4">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      {loading ? (
        <div className="flex items-center justify-center py-12 text-gray-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : errored || !profile ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-gray-300 px-4 py-12 text-center text-sm text-gray-400 dark:border-gray-700">
          <UserCircle className="h-8 w-8" />
          {t('loadError')}
        </div>
      ) : (
        <>
          {/* Read-only profile */}
          <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <div className="flex items-center gap-2">
              <UserCircle className="h-5 w-5 text-gray-400" />
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                {profile.display_name ?? profile.username ?? '—'}
              </h2>
              {profile.status && <StatusBadge tone="info" label={profile.status} />}
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <Field label={t('username')} value={profile.username} />
              <Field label={t('position')} value={profile.position} />
              <Field label={t('department')} value={profile.department} />
              <Field label={t('company')} value={profile.company} />
              <Field label={t('startDate')} value={profile.start_date} />
              <Field
                label={t('workHours')}
                value={
                  profile.work_hours_per_day != null ? String(profile.work_hours_per_day) : null
                }
              />
            </dl>
          </div>

          {/* Bank account */}
          <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Landmark className="h-5 w-5 text-gray-400" />
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                  {t('fieldBankAccount')}
                </h2>
              </div>
              <Button size="sm" variant="outline" onClick={openBank}>
                {t('requestChange')}
              </Button>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <Field label={t('key_bank_name')} value={profile.bank_name} />
              <Field label={t('key_bank_account_no')} value={profile.bank_account_no_masked} />
              <Field label={t('key_bank_account_name')} value={profile.bank_account_name} />
            </dl>
          </div>

          {/* Emergency contact */}
          <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Phone className="h-5 w-5 text-gray-400" />
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                  {t('fieldEmergencyContact')}
                </h2>
              </div>
              <Button size="sm" variant="outline" onClick={openEmergency}>
                {t('requestChange')}
              </Button>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <Field label={t('key_name')} value={emergency?.name ?? null} />
              <Field label={t('key_phone')} value={emergency?.phone ?? null} />
              <Field label={t('key_relation')} value={emergency?.relation ?? null} />
            </dl>
          </div>

          {/* My change requests */}
          <div>
            <h2 className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">
              {t('myRequestsHeading')}
            </h2>
            {rows.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-400 dark:border-gray-700">
                <Inbox className="h-8 w-8" />
                {t('noRequests')}
              </div>
            ) : (
              <DataList>
                {rows.map((r) => (
                  <DataCard
                    key={r.id}
                    accent={STATUS_TONE[r.status]}
                    title={fieldLabel(r.field_key)}
                    status={<StatusBadge tone={STATUS_TONE[r.status]} label={statusLabel(r.status)} />}
                    actions={
                      r.status === 'pending' ? (
                        <Button variant="outline" size="sm" onClick={() => cancelRequest(r.id)}>
                          {t('cancel')}
                        </Button>
                      ) : undefined
                    }
                  >
                    <div className="mt-1">
                      <ValueDiff
                        current={r.current_value}
                        next={r.new_value}
                        keyLabel={keyLabel}
                        currentLabel={t('currentLabel')}
                        newLabel={t('newLabel')}
                        emptyLabel={t('emptyValue')}
                      />
                    </div>
                    {r.reason && (
                      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                        {t('reason')}: {r.reason}
                      </p>
                    )}
                    {r.decision_note && (
                      <p className="mt-1 text-xs text-gray-400">
                        {t('decisionNote')}: {r.decision_note}
                      </p>
                    )}
                  </DataCard>
                ))}
              </DataList>
            )}
          </div>
        </>
      )}

      {/* Bank change modal */}
      <Modal
        isOpen={openField === 'bank_account'}
        onClose={closeModal}
        title={t('bankModalTitle')}
        description={t('approvalNote')}
        size="md"
      >
        <div className="space-y-3">
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">
            {t('key_bank_name')}
            <input value={bankName} onChange={(e) => setBankName(e.target.value)} className="control mt-1 w-full" />
          </label>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">
            {t('key_bank_account_no')}
            <input
              value={bankAccountNo}
              onChange={(e) => setBankAccountNo(e.target.value)}
              inputMode="numeric"
              className="control mt-1 w-full"
            />
          </label>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">
            {t('key_bank_account_name')}
            <input
              value={bankAccountName}
              onChange={(e) => setBankAccountName(e.target.value)}
              className="control mt-1 w-full"
            />
          </label>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">
            {t('reasonOptional')}
            <textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="control mt-1 w-full"
            />
          </label>
        </div>
        <ModalFooter>
          <Button variant="ghost" size="sm" onClick={closeModal}>
            {t('cancel')}
          </Button>
          <Button
            size="sm"
            onClick={submit}
            isLoading={submitting}
            disabled={!canSubmit}
            icon={<Send className="h-4 w-4" />}
          >
            {t('submitRequest')}
          </Button>
        </ModalFooter>
      </Modal>

      {/* Emergency change modal */}
      <Modal
        isOpen={openField === 'emergency_contact'}
        onClose={closeModal}
        title={t('emergencyModalTitle')}
        description={t('approvalNote')}
        size="md"
      >
        <div className="space-y-3">
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">
            {t('key_name')}
            <input value={ecName} onChange={(e) => setEcName(e.target.value)} className="control mt-1 w-full" />
          </label>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">
            {t('key_phone')}
            <input
              value={ecPhone}
              onChange={(e) => setEcPhone(e.target.value)}
              inputMode="tel"
              className="control mt-1 w-full"
            />
          </label>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">
            {t('key_relation')}
            <input
              value={ecRelation}
              onChange={(e) => setEcRelation(e.target.value)}
              className="control mt-1 w-full"
            />
          </label>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">
            {t('reasonOptional')}
            <textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="control mt-1 w-full"
            />
          </label>
        </div>
        <ModalFooter>
          <Button variant="ghost" size="sm" onClick={closeModal}>
            {t('cancel')}
          </Button>
          <Button
            size="sm"
            onClick={submit}
            isLoading={submitting}
            disabled={!canSubmit}
            icon={<Send className="h-4 w-4" />}
          >
            {t('submitRequest')}
          </Button>
        </ModalFooter>
      </Modal>
      {dialog}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="min-w-0">
      <dt className="text-gray-400 dark:text-gray-500">{label}</dt>
      <dd className="truncate font-medium text-gray-900 dark:text-white">{value || '—'}</dd>
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
