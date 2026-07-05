'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Loader2,
  Inbox,
  Plus,
  Printer,
  PenLine,
  Ban,
  CheckCircle2,
  Save,
} from 'lucide-react';
import {
  Button,
  Badge,
  Select,
  Modal,
  ModalFooter,
  PageHeader,
  FilterBar,
  StatusBadge,
  DataList,
  DataCard,
  ViewToggle,
  useViewMode,
  toast,
  type StatusTone,
} from '@/components/ui';
import {
  SignaturePad,
  type SignaturePadHandle,
} from '@/components/ui/signature-pad';
import { todayBangkok } from '@/lib/utils/date';

// ── Types (per P3.4b API contract) ──────────────────────────────────────────
type Kind = 'resignation' | 'termination';
type Status = 'draft' | 'pending_signoff' | 'completed' | 'cancelled';
type Resolution = 'pending' | 'returned' | 'lost' | 'damaged';

interface Person {
  id: string;
  display_name: string | null;
  username: string | null;
}
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
  user_id: string;
  kind: Kind;
  reason: string | null;
  notice_date: string | null;
  last_working_date: string | null;
  severance_note?: string | null;
  status: Status;
  employee_signed_at: string | null;
  hr_signed_at: string | null;
  created_at: string | null;
  employee: Person | null;
  assets?: AssetItem[];
}
interface Employee {
  profile: Person;
}

const KINDS: Kind[] = ['resignation', 'termination'];
const RESOLUTIONS: Resolution[] = ['pending', 'returned', 'lost', 'damaged'];
const STATUS_FILTERS = ['all', 'draft', 'pending_signoff', 'completed', 'cancelled'] as const;

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

// Domain status → shared design-system tones (StatusBadge + DataCard left rail).
const STATUS_TONE: Record<Status, StatusTone> = {
  draft: 'warn',
  pending_signoff: 'info',
  completed: 'good',
  cancelled: 'neutral',
};
const STATUS_ACCENT: Record<Status, 'warn' | 'accent' | 'good' | 'neutral'> = {
  draft: 'warn',
  pending_signoff: 'accent',
  completed: 'good',
  cancelled: 'neutral',
};

const inputCls =
  'control mt-1 w-full disabled:cursor-not-allowed disabled:opacity-60';

const PRINT_CSS = `@media print { @page { margin: 1.6cm; } }`;

function formatDate(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString('th-TH');
}
function formatDateTime(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('th-TH');
}
function personName(p: Person | null): string {
  return p?.display_name ?? p?.username ?? '—';
}

// Local editable copy of an asset row while in draft.
interface AssetDraft {
  asset_id: string;
  asset_code: string | null;
  asset_name: string | null;
  resolution: Resolution;
  note: string;
}

export default function HrOffboardingPage() {
  const t = useTranslations('hr.offboarding');

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [rows, setRows] = useState<Offboarding[]>([]);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [view, setView] = useViewMode('hr-offboarding');

  // initiate modal
  const [initOpen, setInitOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [userId, setUserId] = useState('');
  const [kind, setKind] = useState<Kind>('resignation');
  const [reason, setReason] = useState('');
  const [noticeDate, setNoticeDate] = useState(todayBangkok());
  const [lastWorkingDate, setLastWorkingDate] = useState('');

  // detail
  const [detail, setDetail] = useState<Offboarding | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dReason, setDReason] = useState('');
  const [dNotice, setDNotice] = useState('');
  const [dLast, setDLast] = useState('');
  const [dSeverance, setDSeverance] = useState('');
  const [dAssets, setDAssets] = useState<AssetDraft[]>([]);

  // sign / complete / cancel
  const [signOpen, setSignOpen] = useState(false);
  const [signing, setSigning] = useState(false);
  const signRef = useRef<SignaturePadHandle | null>(null);
  const [completing, setCompleting] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const kindLabel = useCallback((k: Kind) => t(`kind_${k}`), [t]);
  const statusLabel = useCallback((s: Status) => t(`status_${s}`), [t]);
  const resolutionLabel = useCallback((r: Resolution) => t(`resolution_${r}`), [t]);

  // ── Employee source ─────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/hr/employees');
        const json = await res.json().catch(() => ({}));
        setEmployees((json.data ?? []) as Employee[]);
      } catch {
        setEmployees([]);
      }
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setErrored(false);
    try {
      const params = new URLSearchParams();
      if (filterStatus !== 'all') params.set('status', filterStatus);
      const qs = params.toString();
      const res = await fetch(`/api/hr/offboarding${qs ? `?${qs}` : ''}`);
      if (!res.ok) throw new Error();
      const json = await res.json();
      setRows((json.data ?? []) as Offboarding[]);
    } catch {
      setRows([]);
      setErrored(true);
    } finally {
      setLoading(false);
    }
  }, [filterStatus]);

  useEffect(() => {
    load();
  }, [load]);

  // ── Detail ──────────────────────────────────────────────────────────────────
  const openDetail = useCallback(
    async (id: string) => {
      setDetailLoading(true);
      setDetail(null);
      try {
        const res = await fetch(`/api/hr/offboarding/${id}`);
        if (!res.ok) throw new Error();
        const json = await res.json();
        const d = json.data as Offboarding;
        setDetail(d);
        setDReason(d.reason ?? '');
        setDNotice(d.notice_date ?? '');
        setDLast(d.last_working_date ?? '');
        setDSeverance(d.severance_note ?? '');
        setDAssets(
          (d.assets ?? []).map((a) => ({
            asset_id: a.asset_id,
            asset_code: a.asset_code,
            asset_name: a.asset_name,
            resolution: a.resolution,
            note: a.note ?? '',
          }))
        );
      } catch {
        toast({ type: 'error', title: t('detailFailed') });
      } finally {
        setDetailLoading(false);
      }
    },
    [t]
  );

  const refreshDetail = useCallback(async () => {
    if (detail) await openDetail(detail.id);
    await load();
  }, [detail, openDetail, load]);

  const closeDetail = useCallback(() => {
    setDetail(null);
    setDAssets([]);
  }, []);

  // ── Initiate ────────────────────────────────────────────────────────────────
  const openInitiate = () => {
    setUserId('');
    setKind('resignation');
    setReason('');
    setNoticeDate(todayBangkok());
    setLastWorkingDate('');
    setInitOpen(true);
  };

  const canSubmit = Boolean(userId) && !submitting;

  const submitInitiate = useCallback(async () => {
    if (!userId) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/hr/offboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          kind,
          reason: reason.trim() || undefined,
          notice_date: noticeDate || undefined,
          last_working_date: lastWorkingDate || undefined,
        }),
      });
      if (res.status === 409) {
        toast({ type: 'warning', title: t('alreadyInProgress') });
        return;
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || json?.message);
      toast({ type: 'success', title: t('initiated') });
      setInitOpen(false);
      await load();
      const created = json?.data as Offboarding | undefined;
      if (created?.id) await openDetail(created.id);
    } catch (e) {
      toast({
        type: 'error',
        title: e instanceof Error && e.message ? e.message : t('initiateFailed'),
      });
    } finally {
      setSubmitting(false);
    }
  }, [userId, kind, reason, noticeDate, lastWorkingDate, t, load, openDetail]);

  // ── Save draft (dates + assets) ──────────────────────────────────────────────
  const isDraft = detail?.status === 'draft';

  const setAssetResolution = (assetId: string, resolution: Resolution) =>
    setDAssets((prev) =>
      prev.map((a) => (a.asset_id === assetId ? { ...a, resolution } : a))
    );
  const setAssetNote = (assetId: string, note: string) =>
    setDAssets((prev) =>
      prev.map((a) => (a.asset_id === assetId ? { ...a, note } : a))
    );

  const saveDraft = useCallback(async () => {
    if (!detail) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/hr/offboarding/${detail.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: dReason.trim() || undefined,
          notice_date: dNotice || undefined,
          last_working_date: dLast || undefined,
          severance_note: dSeverance.trim() || undefined,
          assets: dAssets.map((a) => ({
            asset_id: a.asset_id,
            resolution: a.resolution,
            note: a.note.trim() || undefined,
          })),
        }),
      });
      if (res.status === 409) {
        toast({ type: 'warning', title: t('notDraft') });
        await refreshDetail();
        return;
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || json?.message);
      toast({ type: 'success', title: t('saved') });
      await refreshDetail();
    } catch {
      toast({ type: 'error', title: t('saveFailed') });
    } finally {
      setSaving(false);
    }
  }, [detail, dReason, dNotice, dLast, dSeverance, dAssets, t, refreshDetail]);

  // ── HR sign-off ──────────────────────────────────────────────────────────────
  const submitSign = useCallback(async () => {
    if (!detail) return;
    const pad = signRef.current;
    if (!pad || pad.isEmpty()) {
      toast({ type: 'warning', title: t('signRequired') });
      return;
    }
    const signature = pad.toDataURL();
    if (!signature) {
      toast({ type: 'warning', title: t('signRequired') });
      return;
    }
    setSigning(true);
    try {
      const res = await fetch(`/api/hr/offboarding/${detail.id}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signature }),
      });
      if (res.status === 409) {
        toast({ type: 'warning', title: t('alreadySigned') });
        setSignOpen(false);
        await refreshDetail();
        return;
      }
      if (!res.ok) throw new Error();
      toast({ type: 'success', title: t('signed') });
      setSignOpen(false);
      await refreshDetail();
    } catch {
      toast({ type: 'error', title: t('signFailed') });
    } finally {
      setSigning(false);
    }
  }, [detail, t, refreshDetail]);

  // ── Complete ─────────────────────────────────────────────────────────────────
  const assetsAllResolved = useMemo(
    () => dAssets.every((a) => a.resolution !== 'pending'),
    [dAssets]
  );
  const completeBlockReason = useMemo(() => {
    if (!detail) return '';
    if (!dLast) return t('completeNeedsLastDate');
    if (!assetsAllResolved) return t('completeNeedsAssets');
    return '';
  }, [detail, dLast, assetsAllResolved, t]);

  const submitComplete = useCallback(async () => {
    if (!detail) return;
    setCompleting(true);
    try {
      const res = await fetch(`/api/hr/offboarding/${detail.id}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 400) {
        toast({ type: 'warning', title: json?.error || t('completeBlocked') });
        return;
      }
      if (res.status === 409) {
        toast({ type: 'warning', title: t('completeConflict') });
        await refreshDetail();
        return;
      }
      if (!res.ok) throw new Error();
      toast({ type: 'success', title: t('completed') });
      if (json?.warning) toast({ type: 'warning', title: json.warning });
      await refreshDetail();
    } catch {
      toast({ type: 'error', title: t('completeFailed') });
    } finally {
      setCompleting(false);
    }
  }, [detail, t, refreshDetail]);

  // ── Cancel ───────────────────────────────────────────────────────────────────
  const submitCancel = useCallback(async () => {
    if (!detail) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/hr/offboarding/${detail.id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.status === 409) {
        toast({ type: 'warning', title: t('cancelConflict') });
        await refreshDetail();
        return;
      }
      if (!res.ok) throw new Error();
      toast({ type: 'success', title: t('cancelled') });
      setCancelOpen(false);
      await refreshDetail();
    } catch {
      toast({ type: 'error', title: t('cancelFailed') });
    } finally {
      setCancelling(false);
    }
  }, [detail, t, refreshDetail]);

  const doPrint = useCallback(() => {
    setTimeout(() => window.print(), 60);
  }, []);

  const statusOptions = STATUS_FILTERS.map((s) => ({
    value: s,
    label: s === 'all' ? t('statusAll') : statusLabel(s as Status),
  }));

  const canEdit = isDraft;
  const canSign = detail && !detail.hr_signed_at && detail.status !== 'completed' && detail.status !== 'cancelled';
  const canComplete = detail && detail.status !== 'completed' && detail.status !== 'cancelled';
  const canCancel = detail && detail.status !== 'completed' && detail.status !== 'cancelled';

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <style>{PRINT_CSS}</style>

      {/* On-screen content */}
      <div className="space-y-4 print:hidden">
        <PageHeader
          title={t('title')}
          subtitle={t('subtitle')}
          actions={
            <>
              <ViewToggle value={view} onChange={setView} />
              <Button size="sm" onClick={openInitiate} icon={<Plus className="h-4 w-4" />}>
                {t('initiate')}
              </Button>
            </>
          }
        />

        {/* filter */}
        <FilterBar>
          <Select
            label={t('filterStatus')}
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            options={statusOptions}
          />
        </FilterBar>

        {/* list */}
        {loading ? (
          <div className="flex items-center justify-center py-12 text-gray-400">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : errored ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-red-300 px-4 py-12 text-center text-sm text-red-400 dark:border-red-800">
            {t('loadFailed')}
            <Button size="sm" variant="outline" onClick={load}>
              {t('retry')}
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-gray-300 px-4 py-12 text-center text-sm text-gray-400 dark:border-gray-700">
            <Inbox className="h-8 w-8" />
            {t('empty')}
          </div>
        ) : (
          <DataList compact={view === 'compact'}>
            {rows.map((o) => (
              <DataCard
                key={o.id}
                onClick={() => openDetail(o.id)}
                accent={STATUS_ACCENT[o.status]}
                title={personName(o.employee)}
                status={<StatusBadge tone={STATUS_TONE[o.status]} label={statusLabel(o.status)} />}
              >
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge
                      tone={o.kind === 'termination' ? 'critical' : 'neutral'}
                      label={kindLabel(o.kind)}
                    />
                  </div>
                  <p>
                    {t('lastWorkingDate')}: {formatDate(o.last_working_date)}
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <SignChip label={t('empSigned')} done={Boolean(o.employee_signed_at)} />
                    <SignChip label={t('hrSigned')} done={Boolean(o.hr_signed_at)} />
                  </div>
                </div>
              </DataCard>
            ))}
          </DataList>
        )}
      </div>

      {/* Print-only summary */}
      {detail && (
        <div className="hidden print:block">
          <div className="text-black">
            <h1 className="mb-1 text-lg font-bold">{t('printTitle')}</h1>
            <p className="mb-4 text-xs text-gray-600">{t('printSubtitle')}</p>
            <table className="w-full border-collapse text-sm">
              <tbody>
                <PrintRow label={t('employee')} value={personName(detail.employee)} />
                <PrintRow label={t('kind')} value={kindLabel(detail.kind)} />
                <PrintRow label={t('reason')} value={detail.reason || '—'} />
                <PrintRow label={t('noticeDate')} value={formatDate(detail.notice_date)} />
                <PrintRow label={t('lastWorkingDate')} value={formatDate(detail.last_working_date)} />
                <PrintRow label={t('status')} value={statusLabel(detail.status)} />
              </tbody>
            </table>

            <h2 className="mb-2 mt-6 text-sm font-semibold">{t('assetChecklist')}</h2>
            {(detail.assets ?? []).length === 0 ? (
              <p className="text-xs text-gray-600">{t('noAssets')}</p>
            ) : (
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-gray-400 text-left">
                    <th className="py-1 pr-3 font-medium">{t('assetCode')}</th>
                    <th className="py-1 pr-3 font-medium">{t('assetName')}</th>
                    <th className="py-1 pr-3 font-medium">{t('resolution')}</th>
                    <th className="py-1 font-medium">{t('note')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(detail.assets ?? []).map((a) => (
                    <tr key={a.id} className="border-b border-gray-300 align-top">
                      <td className="py-1 pr-3">{a.asset_code || '—'}</td>
                      <td className="py-1 pr-3">{a.asset_name || '—'}</td>
                      <td className="py-1 pr-3">{resolutionLabel(a.resolution)}</td>
                      <td className="py-1 whitespace-pre-wrap">{a.note || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <h2 className="mb-2 mt-6 text-sm font-semibold">{t('signaturesHeading')}</h2>
            <div className="flex gap-8">
              <div className="flex-1 text-center">
                <div className="mb-1 h-16 border-b border-gray-500" />
                <p className="text-xs font-medium">{t('empSigned')}</p>
                <p className="text-[10px] text-gray-600">
                  {detail.employee_signed_at ? formatDateTime(detail.employee_signed_at) : t('notSigned')}
                </p>
              </div>
              <div className="flex-1 text-center">
                <div className="mb-1 h-16 border-b border-gray-500" />
                <p className="text-xs font-medium">{t('hrSigned')}</p>
                <p className="text-[10px] text-gray-600">
                  {detail.hr_signed_at ? formatDateTime(detail.hr_signed_at) : t('notSigned')}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Initiate modal */}
      <Modal
        isOpen={initOpen}
        onClose={() => !submitting && setInitOpen(false)}
        title={t('initiateTitle')}
        size="lg"
      >
        <div className="space-y-4">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('employee')}
            <select value={userId} onChange={(e) => setUserId(e.target.value)} className={inputCls}>
              <option value="">{t('selectEmployee')}</option>
              {employees.map((emp) => (
                <option key={emp.profile.id} value={emp.profile.id}>
                  {personName(emp.profile)}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('kind')}
            <select value={kind} onChange={(e) => setKind(e.target.value as Kind)} className={inputCls}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {kindLabel(k)}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('reason')}
            <textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('reasonPlaceholder')}
              className={inputCls}
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('noticeDate')}
              <input
                type="date"
                value={noticeDate}
                onChange={(e) => setNoticeDate(e.target.value)}
                className={inputCls}
              />
            </label>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('lastWorkingDate')}
              <input
                type="date"
                value={lastWorkingDate}
                onChange={(e) => setLastWorkingDate(e.target.value)}
                className={inputCls}
              />
            </label>
          </div>
        </div>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setInitOpen(false)} disabled={submitting}>
            {t('cancel')}
          </Button>
          <Button onClick={submitInitiate} isLoading={submitting} disabled={!canSubmit}>
            {t('submit')}
          </Button>
        </ModalFooter>
      </Modal>

      {/* Detail modal */}
      <Modal
        isOpen={detail !== null || detailLoading}
        onClose={closeDetail}
        title={t('detailTitle')}
        description={detail ? personName(detail.employee) : undefined}
        size="xl"
      >
        {detailLoading || !detail ? (
          <div className="flex items-center justify-center py-12 text-gray-400">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (
          <div className="space-y-5">
            {/* status chips */}
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={KIND_BADGE[detail.kind]} size="md">
                {kindLabel(detail.kind)}
              </Badge>
              <Badge variant={STATUS_BADGE[detail.status]} size="md">
                {statusLabel(detail.status)}
              </Badge>
              <SignChip label={t('empSigned')} done={Boolean(detail.employee_signed_at)} />
              <SignChip label={t('hrSigned')} done={Boolean(detail.hr_signed_at)} />
            </div>

            {/* dates + reason (editable in draft) */}
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('noticeDate')}
                <input
                  type="date"
                  value={dNotice}
                  disabled={!canEdit}
                  onChange={(e) => setDNotice(e.target.value)}
                  className={inputCls}
                />
              </label>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('lastWorkingDate')}
                <input
                  type="date"
                  value={dLast}
                  disabled={!canEdit}
                  onChange={(e) => setDLast(e.target.value)}
                  className={inputCls}
                />
              </label>
            </div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('reason')}
              <textarea
                rows={2}
                value={dReason}
                disabled={!canEdit}
                onChange={(e) => setDReason(e.target.value)}
                className={inputCls}
              />
            </label>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('severanceNote')}
              <textarea
                rows={2}
                value={dSeverance}
                disabled={!canEdit}
                onChange={(e) => setDSeverance(e.target.value)}
                placeholder={t('severancePlaceholder')}
                className={inputCls}
              />
            </label>

            {/* asset checklist */}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                {t('assetChecklist')}
              </h3>
              {dAssets.length === 0 ? (
                <p className="rounded-lg border border-dashed border-gray-300 px-3 py-4 text-center text-xs text-gray-400 dark:border-gray-700">
                  {t('noAssets')}
                </p>
              ) : (
                <ul className="space-y-2">
                  {dAssets.map((a) => (
                    <li
                      key={a.asset_id}
                      className="rounded-lg border border-gray-200 p-2.5 dark:border-gray-700"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 dark:text-white">
                            {a.asset_name || '—'}
                          </p>
                          <p className="text-xs text-gray-400">{a.asset_code || '—'}</p>
                        </div>
                        <Badge variant={RESOLUTION_BADGE[a.resolution]} size="sm">
                          {resolutionLabel(a.resolution)}
                        </Badge>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <select
                          value={a.resolution}
                          disabled={!canEdit}
                          onChange={(e) => setAssetResolution(a.asset_id, e.target.value as Resolution)}
                          className={inputCls}
                        >
                          {RESOLUTIONS.map((r) => (
                            <option key={r} value={r}>
                              {resolutionLabel(r)}
                            </option>
                          ))}
                        </select>
                        <input
                          type="text"
                          value={a.note}
                          disabled={!canEdit}
                          onChange={(e) => setAssetNote(a.asset_id, e.target.value)}
                          placeholder={t('notePlaceholder')}
                          className={inputCls}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {canEdit && (
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={saveDraft}
                  isLoading={saving}
                  icon={<Save className="h-3.5 w-3.5" />}
                >
                  {t('save')}
                </Button>
              </div>
            )}

            {/* complete block reason */}
            {canComplete && completeBlockReason && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
                {completeBlockReason}
              </p>
            )}

            {/* actions */}
            <div className="flex flex-wrap justify-end gap-2 border-t border-gray-100 pt-4 dark:border-gray-700">
              <Button size="sm" variant="ghost" onClick={doPrint} icon={<Printer className="h-3.5 w-3.5" />}>
                {t('print')}
              </Button>
              {canCancel && (
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => setCancelOpen(true)}
                  icon={<Ban className="h-3.5 w-3.5" />}
                >
                  {t('cancel')}
                </Button>
              )}
              {canSign && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setSignOpen(true)}
                  icon={<PenLine className="h-3.5 w-3.5" />}
                >
                  {t('signHr')}
                </Button>
              )}
              {canComplete && (
                <Button
                  size="sm"
                  onClick={submitComplete}
                  isLoading={completing}
                  disabled={Boolean(completeBlockReason)}
                  icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                >
                  {t('complete')}
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Sign modal */}
      <Modal
        isOpen={signOpen}
        onClose={() => !signing && setSignOpen(false)}
        title={t('signTitle')}
        size="lg"
      >
        <div className="space-y-2">
          <p className="text-sm text-gray-600 dark:text-gray-400">{t('signPrompt')}</p>
          <SignaturePad ref={signRef} />
        </div>
        <ModalFooter>
          <Button variant="ghost" size="sm" onClick={() => signRef.current?.clear()} disabled={signing}>
            {t('clear')}
          </Button>
          <Button size="sm" onClick={submitSign} isLoading={signing}>
            {t('submit')}
          </Button>
        </ModalFooter>
      </Modal>

      {/* Cancel confirm modal */}
      <Modal
        isOpen={cancelOpen}
        onClose={() => !cancelling && setCancelOpen(false)}
        title={t('cancelTitle')}
        size="md"
      >
        <p className="text-sm text-gray-600 dark:text-gray-400">{t('cancelPrompt')}</p>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setCancelOpen(false)} disabled={cancelling}>
            {t('keep')}
          </Button>
          <Button variant="danger" onClick={submitCancel} isLoading={cancelling}>
            {t('cancelConfirm')}
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

function PrintRow({ label, value }: { label: string; value: string }) {
  return (
    <tr className="border-b border-gray-300 align-top">
      <td className="w-40 py-1.5 pr-3 font-medium text-gray-700">{label}</td>
      <td className="py-1.5 whitespace-pre-wrap">{value}</td>
    </tr>
  );
}
