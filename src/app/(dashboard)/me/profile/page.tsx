'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Loader2, UserCircle, Landmark, Phone, Send, Inbox, Wallet, CalendarClock } from 'lucide-react';
import { Button, Modal, ModalFooter, PageHeader, ViewToggle, useViewMode, DataList, DataCard, StatusBadge, useConfirm, toast } from '@/components/ui';
import { TileNotices } from '../_components/tile-notices';
import { AccountSettings } from './_components/account-settings';
import { EmployeeName } from '@/components/hr/employee-name';

type Status = 'pending' | 'approved' | 'rejected' | 'cancelled';
// full_name added 2026-08-07: the legal ชื่อ-นามสกุล drives ภ.ง.ด.1 / สปส. / ใบ 50 ทวิ and the
// bank-transfer file, so a correction is requested and HR approves it — never a direct self-edit.
type FieldKey = 'bank_account' | 'emergency_contact' | 'full_name';

interface Profile {
  display_name: string | null;
  full_name: string | null;
  employee_code: string | null;
  has_employee_record: boolean;
  username: string | null;
  avatar_url: string | null;
  phone: string | null;
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

  // ?tab=settings deep-links straight to the merged account settings — the avatar menu's
  // "ตั้งค่าการแจ้งเตือน" item uses it. Read off window.location so no Suspense boundary is needed
  // (same pattern as /hr/employees).
  const [tab, setTab] = useState<'info' | 'settings'>('info');
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('tab') === 'settings') setTab('settings');
  }, []);

  const [view, setView] = useViewMode('me-profile');
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
  // legal-name correction
  const [fullNameDraft, setFullNameDraft] = useState('');

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
      f === 'bank_account'
        ? t('fieldBankAccount')
        : f === 'full_name'
          ? 'ชื่อ-นามสกุล'
          : t('fieldEmergencyContact'),
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

  // Self-service extras (owner ask 2026-07-05): own photo, own phone, identity-link status.
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [phoneDraft, setPhoneDraft] = useState('');
  const [phoneBusy, setPhoneBusy] = useState(false);
  const [identity, setIdentity] = useState<{ linked: boolean; claim: { full_name_th: string } | null } | null>(null);

  const loadIdentity = useCallback(async () => {
    try {
      const res = await fetch('/api/hr/ess/identity');
      const json = await res.json().catch(() => ({}));
      if (res.ok) setIdentity(json.data ?? null);
    } catch { /* the banner simply stays hidden */ }
  }, []);

  const uploadAvatar = useCallback(async (file: File) => {
    setAvatarBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/hr/ess/avatar', { method: 'POST', body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : undefined);
      setProfile((p) => (p ? { ...p, avatar_url: (json.data?.avatar_url as string) ?? p.avatar_url } : p));
      toast({ type: 'success', title: t('photoUpdated') });
    } catch (e) {
      toast({ type: 'error', title: t('actionFailed'), message: e instanceof Error ? e.message : undefined });
    } finally {
      setAvatarBusy(false);
    }
  }, [t]);

  const savePhone = useCallback(async () => {
    setPhoneBusy(true);
    try {
      const res = await fetch('/api/hr/ess/profile/contact', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phoneDraft }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : undefined);
      setProfile((p) => (p ? { ...p, phone: (json.data?.phone as string | null) ?? null } : p));
      setPhoneOpen(false);
      toast({ type: 'success', title: t('phoneUpdated') });
    } catch (e) {
      toast({ type: 'error', title: t('actionFailed'), message: e instanceof Error ? e.message : undefined });
    } finally {
      setPhoneBusy(false);
    }
  }, [phoneDraft, t]);

  // Opens the app-wide identity-claim modal (it listens for this event and skips its snooze).
  const openIdentityClaim = useCallback(() => {
    try { localStorage.removeItem('hr-identity-snooze'); } catch { /* ignore */ }
    window.dispatchEvent(new Event('hr-identity-open'));
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadProfile(), loadRows(), loadIdentity()]);
    setLoading(false);
  }, [loadProfile, loadRows, loadIdentity]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // After the claim modal submits, re-read identity so the "ผูกชื่อ" button flips to the
  // "รอ HR อนุมัติ" banner right away (no stale, re-clickable button in the same session).
  useEffect(() => {
    const onUpdated = () => { loadIdentity(); };
    window.addEventListener('hr-identity-updated', onUpdated);
    return () => window.removeEventListener('hr-identity-updated', onUpdated);
  }, [loadIdentity]);

  const closeModal = useCallback(() => {
    setOpenField(null);
    setReason('');
    setBankName('');
    setBankAccountNo('');
    setBankAccountName('');
    setEcName('');
    setEcPhone('');
    setEcRelation('');
    setFullNameDraft('');
  }, []);

  const openFullName = useCallback(() => {
    setFullNameDraft(profile?.full_name ?? '');
    setReason('');
    setOpenField('full_name');
  }, [profile]);

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
  // A name "correction" that changes nothing is not a request worth queuing for HR.
  const fullNameValid =
    Boolean(fullNameDraft.trim()) && fullNameDraft.trim() !== (profile?.full_name ?? '').trim();
  const canSubmit =
    !submitting &&
    (openField === 'bank_account' ? bankValid : openField === 'full_name' ? fullNameValid : emergencyValid);

  const submit = useCallback(async () => {
    if (!openField || !canSubmit) return;
    const new_value =
      openField === 'bank_account'
        ? {
            bank_name: bankName.trim(),
            bank_account_no: bankAccountNo.trim(),
            bank_account_name: bankAccountName.trim(),
          }
        : openField === 'full_name'
          ? { full_name: fullNameDraft.trim() }
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
    fullNameDraft,
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
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={tab === 'info' ? <ViewToggle value={view} onChange={setView} /> : undefined}
      />

      {/* The app used to have two profile screens — /profile (account settings, from the avatar
          menu) and /me/profile (employee data, from the /me hub). They are one page with two
          tabs now; /profile redirects here. */}
      <div className="flex gap-1 rounded-xl bg-gray-100 p-1 dark:bg-gray-800">
        {(
          [
            { key: 'info', label: 'ข้อมูลส่วนตัว' },
            { key: 'settings', label: 'การตั้งค่าบัญชี' },
          ] as const
        ).map((tb) => (
          <button
            key={tb.key}
            type="button"
            onClick={() => setTab(tb.key)}
            className={`flex-1 cursor-pointer rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              tab === tb.key
                ? 'bg-white text-indigo-600 shadow-sm dark:bg-gray-700 dark:text-indigo-300'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {tab === 'settings' ? (
        <AccountSettings />
      ) : (
        <>
      <TileNotices tile="profile" />

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
          {/* Read-only profile + self-service (photo / phone / identity link) */}
          <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <div className="flex items-center gap-3">
              {profile.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={profile.avatar_url} alt="" className="h-14 w-14 shrink-0 rounded-full object-cover ring-2 ring-gray-200 dark:ring-gray-700" />
              ) : (
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-lg font-semibold text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-300">
                  {(profile.display_name || profile.username || '?').charAt(0).toUpperCase()}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {/* ชื่อจริง leads, ชื่อเล่น trails — the project-wide rule (lib/hr/employee-name) */}
                  <h2 className="truncate text-sm font-semibold text-gray-900 dark:text-white">
                    <EmployeeName source={profile} />
                  </h2>
                  {profile.status && <StatusBadge tone="info" label={profile.status} />}
                </div>
                <label className={`mt-1 inline-block cursor-pointer rounded-lg border border-gray-300 px-2.5 py-1 text-[11px] font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700/50 ${avatarBusy ? 'pointer-events-none opacity-50' : ''}`}>
                  {avatarBusy ? '…' : t('uploadPhoto')}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    disabled={avatarBusy}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) uploadAvatar(f);
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>
            </div>

            {/* identity link status — the door into the claim flow (also auto-pops app-wide) */}
            {identity && !identity.linked && (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 dark:border-amber-800 dark:bg-amber-900/10">
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  {identity.claim ? t('identityPending', { name: identity.claim.full_name_th }) : t('identityUnlinked')}
                </p>
                {!identity.claim && (
                  <Button size="sm" onClick={openIdentityClaim}>{t('identityLinkNow')}</Button>
                )}
              </div>
            )}

            {/* ชื่อ-นามสกุล — read-only. This is the legal name on ภ.ง.ด.1 / สปส. / ใบ 50 ทวิ and the
                bank-transfer file, so a correction goes to HR for approval instead of applying
                straight away (owner decision 2026-08-07). */}
            {profile.has_employee_record && (
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2 text-xs">
                  <UserCircle className="h-4 w-4 shrink-0 text-gray-400" />
                  <span className="text-gray-500 dark:text-gray-400">ชื่อ-นามสกุล:</span>
                  <span className="truncate font-medium text-gray-800 dark:text-gray-100">
                    {profile.full_name || '—'}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={openFullName}
                  disabled={rows.some((r) => r.field_key === 'full_name' && r.status === 'pending')}
                >
                  {rows.some((r) => r.field_key === 'full_name' && r.status === 'pending')
                    ? 'รออนุมัติ'
                    : 'ขอแก้ไข'}
                </Button>
              </div>
            )}

            {/* phone — self-service, applies immediately */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2 text-xs">
                <Phone className="h-4 w-4 shrink-0 text-gray-400" />
                <span className="text-gray-500 dark:text-gray-400">{t('phone')}:</span>
                <span className="truncate font-medium text-gray-800 dark:text-gray-100">{profile.phone || '—'}</span>
              </div>
              <Button size="sm" variant="outline" onClick={() => { setPhoneDraft(profile.phone ?? ''); setPhoneOpen(true); }}>
                {t('editPhone')}
              </Button>
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

            {/* quick links — the two things people open their profile to check */}
            <div className="grid grid-cols-2 gap-2 border-t border-gray-100 pt-3 dark:border-gray-700/60">
              <Link
                href="/me/payslips"
                className="flex items-center justify-center gap-1.5 rounded-lg bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 transition-colors hover:bg-indigo-100 dark:bg-indigo-900/30 dark:text-indigo-300 dark:hover:bg-indigo-900/50"
              >
                <Wallet className="h-4 w-4" /> {t('viewPayslips')}
              </Link>
              <Link
                href="/me/timesheet"
                className="flex items-center justify-center gap-1.5 rounded-lg bg-teal-50 px-3 py-2 text-xs font-semibold text-teal-700 transition-colors hover:bg-teal-100 dark:bg-teal-900/30 dark:text-teal-300 dark:hover:bg-teal-900/50"
              >
                <CalendarClock className="h-4 w-4" /> {t('viewTimesheet')}
              </Link>
            </div>
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
              <DataList compact={view === 'compact'}>
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

      {/* Legal-name correction — request only, HR applies it after approving */}
      <Modal
        isOpen={openField === 'full_name'}
        onClose={closeModal}
        title="ขอแก้ไขชื่อ-นามสกุล"
        description="ชื่อนี้ใช้ยื่น ภ.ง.ด.1 / สปส. / ใบ 50 ทวิ และไฟล์โอนเงินธนาคาร จึงต้องให้ HR ตรวจสอบก่อน"
        size="md"
      >
        <div className="space-y-3">
          <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs dark:bg-gray-800/60">
            <span className="text-gray-500 dark:text-gray-400">ชื่อปัจจุบัน: </span>
            <span className="font-medium text-gray-800 dark:text-gray-100">{profile?.full_name || '—'}</span>
          </div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">
            ชื่อ-นามสกุลที่ถูกต้อง
            <input
              value={fullNameDraft}
              onChange={(e) => setFullNameDraft(e.target.value)}
              placeholder="เช่น นางสาวไอนิชา อินต๊ะ"
              className="control mt-1 w-full"
            />
          </label>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">
            {t('reasonOptional')}
            <textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="เช่น สะกดผิดตอนนำเข้าจากชีท / เปลี่ยนชื่อตามทะเบียนราษฎร์"
              className="control mt-1 w-full"
            />
          </label>
        </div>
        <ModalFooter>
          <Button variant="ghost" size="sm" onClick={closeModal}>
            {t('cancel')}
          </Button>
          <Button size="sm" onClick={submit} disabled={!canSubmit}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
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

      {/* self-service phone edit */}
      <Modal isOpen={phoneOpen} onClose={() => setPhoneOpen(false)} title={t('editPhone')} size="sm">
        <input
          type="tel"
          value={phoneDraft}
          onChange={(e) => setPhoneDraft(e.target.value)}
          placeholder="08x-xxx-xxxx"
          className="control w-full"
          aria-label={t('phone')}
          autoFocus
        />
        <ModalFooter>
          <Button variant="ghost" onClick={() => setPhoneOpen(false)}>{t('cancel')}</Button>
          <Button onClick={savePhone} isLoading={phoneBusy}>{t('save')}</Button>
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
