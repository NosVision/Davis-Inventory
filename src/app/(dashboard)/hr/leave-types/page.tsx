'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Pencil, Trash2, CalendarDays, ListChecks } from 'lucide-react';
import {
  Button,
  Input,
  Select,
  Modal,
  ModalFooter,
  Badge,
  Tabs,
  EmptyState,
  toast,
} from '@/components/ui';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CompanyOpt {
  id: string;
  name: string;
}

interface LeaveTypeRow {
  id: string;
  company_id: string | null;
  code: string;
  name_th: string;
  name_en: string;
  paid: boolean;
  requires_cert: boolean;
  requires_reason: boolean;
  annual_quota_days: number | null;
  max_consecutive_days: number | null;
  probational_allowed: boolean;
  advance_notice_days: number | null;
  paid_percent: number | null;
  sort_order: number;
  active: boolean;
}

interface HolidayRow {
  id: string;
  company_id: string | null;
  holiday_date: string;
  name_th: string;
  name_en: string;
  is_public_holiday: boolean;
  active: boolean;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Empty string ⇒ null; otherwise the numeric value (for nullable int fields). */
function numOrNull(v: string): number | null {
  const t = v.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const CURRENT_YEAR = new Date().getFullYear();

// ===========================================================================
// Leave-type modal (create + edit)
// ===========================================================================

interface LeaveTypeFormState {
  code: string;
  name_th: string;
  name_en: string;
  paid: boolean;
  requires_cert: boolean;
  probational_allowed: boolean;
  annual_quota_days: string;
  advance_notice_days: string;
  max_consecutive_days: string;
  sort_order: string;
}

const EMPTY_LEAVE_FORM: LeaveTypeFormState = {
  code: '',
  name_th: '',
  name_en: '',
  paid: true,
  requires_cert: false,
  probational_allowed: true,
  annual_quota_days: '',
  advance_notice_days: '',
  max_consecutive_days: '',
  sort_order: '0',
};

interface LeaveTypeModalProps {
  open: boolean;
  editing: LeaveTypeRow | null;
  companyId: string;
  onClose: () => void;
  onSaved: () => void;
}

function LeaveTypeModal({ open, editing, companyId, onClose, onSaved }: LeaveTypeModalProps) {
  const t = useTranslations('hr.leaveTypes');
  const [form, setForm] = useState<LeaveTypeFormState>(EMPTY_LEAVE_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setForm({
        code: editing.code,
        name_th: editing.name_th,
        name_en: editing.name_en,
        paid: editing.paid,
        requires_cert: editing.requires_cert,
        probational_allowed: editing.probational_allowed,
        annual_quota_days: editing.annual_quota_days != null ? String(editing.annual_quota_days) : '',
        advance_notice_days: editing.advance_notice_days != null ? String(editing.advance_notice_days) : '',
        max_consecutive_days: editing.max_consecutive_days != null ? String(editing.max_consecutive_days) : '',
        sort_order: String(editing.sort_order ?? 0),
      });
    } else {
      setForm(EMPTY_LEAVE_FORM);
    }
  }, [open, editing]);

  const set = <K extends keyof LeaveTypeFormState>(key: K, value: LeaveTypeFormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const save = async () => {
    const code = form.code.trim().toLowerCase();
    if (!editing && !/^[a-z_]+$/.test(code)) {
      toast({ type: 'error', title: t('invalidCode') });
      return;
    }
    if (!form.name_th.trim() || !form.name_en.trim()) {
      toast({ type: 'error', title: t('requiredFields') });
      return;
    }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name_th: form.name_th.trim(),
        name_en: form.name_en.trim(),
        paid: form.paid,
        requires_cert: form.requires_cert,
        probational_allowed: form.probational_allowed,
        annual_quota_days: numOrNull(form.annual_quota_days),
        advance_notice_days: numOrNull(form.advance_notice_days),
        max_consecutive_days: numOrNull(form.max_consecutive_days),
        sort_order: Number(form.sort_order) || 0,
      };
      if (!editing) {
        payload.code = code;
        payload.company_id = companyId || null;
      }

      const url = editing ? `/api/hr/leave-types/${editing.id}` : '/api/hr/leave-types';
      const res = await fetch(url, {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        toast({ type: 'error', title: t('saveFailed'), message: json.error });
        return;
      }
      toast({ type: 'success', title: editing ? t('savedOk') : t('createdOk') });
      onSaved();
      onClose();
    } catch (err) {
      toast({
        type: 'error',
        title: t('saveFailed'),
        message: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title={editing ? t('editLeaveType') : t('addLeaveType')}
      size="lg"
    >
      <div className="space-y-4">
        <Input
          label={t('code')}
          value={form.code}
          onChange={(e) => set('code', e.target.value)}
          placeholder="sick"
          disabled={!!editing}
          hint={editing ? undefined : t('codeHint')}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label={t('nameTh')}
            value={form.name_th}
            onChange={(e) => set('name_th', e.target.value)}
          />
          <Input
            label={t('nameEn')}
            value={form.name_en}
            onChange={(e) => set('name_en', e.target.value)}
          />
        </div>

        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" checked={form.paid} onChange={(e) => set('paid', e.target.checked)} />
            {t('paid')}
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={form.requires_cert}
              onChange={(e) => set('requires_cert', e.target.checked)}
            />
            {t('requiresCert')}
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={form.probational_allowed}
              onChange={(e) => set('probational_allowed', e.target.checked)}
            />
            {t('probationalAllowed')}
          </label>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label={t('annualQuota')}
            type="number"
            min={1}
            value={form.annual_quota_days}
            onChange={(e) => set('annual_quota_days', e.target.value)}
            hint={t('optional')}
          />
          <Input
            label={t('advanceNotice')}
            type="number"
            min={0}
            value={form.advance_notice_days}
            onChange={(e) => set('advance_notice_days', e.target.value)}
            hint={t('optional')}
          />
          <Input
            label={t('maxConsecutive')}
            type="number"
            min={1}
            value={form.max_consecutive_days}
            onChange={(e) => set('max_consecutive_days', e.target.value)}
            hint={t('optional')}
          />
          <Input
            label={t('sortOrder')}
            type="number"
            value={form.sort_order}
            onChange={(e) => set('sort_order', e.target.value)}
          />
        </div>
      </div>

      <ModalFooter>
        <Button variant="ghost" onClick={onClose} disabled={saving}>
          {t('cancel')}
        </Button>
        <Button onClick={save} isLoading={saving}>
          {t('save')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

// ===========================================================================
// Leave Types tab
// ===========================================================================

function LeaveTypesTab({ companyId }: { companyId: string }) {
  const t = useTranslations('hr.leaveTypes');
  const [rows, setRows] = useState<LeaveTypeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<LeaveTypeRow | null>(null);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const qs = companyId ? `?company_id=${encodeURIComponent(companyId)}` : '';
      const res = await fetch(`/api/hr/leave-types${qs}`);
      if (res.ok) {
        const json = await res.json();
        setRows((json.data ?? []) as LeaveTypeRow[]);
      } else {
        const json = await res.json().catch(() => ({}));
        toast({ type: 'error', title: t('saveFailed'), message: json.error });
      }
    } catch (err) {
      toast({
        type: 'error',
        title: t('saveFailed'),
        message: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, [companyId, t]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const toggleActive = async (row: LeaveTypeRow) => {
    setBusy(true);
    try {
      const res = row.active
        ? await fetch(`/api/hr/leave-types/${row.id}`, { method: 'DELETE' })
        : await fetch(`/api/hr/leave-types/${row.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ active: true }),
          });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        toast({ type: 'error', title: t('saveFailed'), message: json.error });
        return;
      }
      toast({ type: 'success', title: row.active ? t('deactivatedOk') : t('savedOk') });
      await fetchRows();
    } catch (err) {
      toast({
        type: 'error',
        title: t('saveFailed'),
        message: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  };

  const openAdd = () => {
    setEditing(null);
    setModalOpen(true);
  };
  const openEdit = (row: LeaveTypeRow) => {
    setEditing(row);
    setModalOpen(true);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('leaveTypesHint')}</p>
        <Button size="sm" onClick={openAdd}>
          <Plus className="h-4 w-4" />
          {t('addLeaveType')}
        </Button>
      </div>

      {loading ? (
        <div className="py-10 text-center text-sm text-gray-400">…</div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title={t('noLeaveTypes')}
          description={t('noLeaveTypesDesc')}
          action={
            <Button size="sm" onClick={openAdd}>
              <Plus className="h-4 w-4" />
              {t('addLeaveType')}
            </Button>
          }
        />
      ) : (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 dark:divide-gray-800 dark:border-gray-700">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-white px-3 py-2.5 dark:bg-gray-900"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900 dark:text-white">{row.name_th}</span>
                  <span className="truncate text-xs text-gray-400">{row.name_en}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <code className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                    {row.code}
                  </code>
                  <Badge variant={row.paid ? 'success' : 'default'} size="sm">
                    {row.paid ? t('paid') : t('unpaid')}
                  </Badge>
                  {row.requires_cert && (
                    <Badge variant="warning" size="sm">
                      {t('certBadge')}
                    </Badge>
                  )}
                  {row.annual_quota_days != null && (
                    <span className="text-[11px] text-gray-500 dark:text-gray-400">
                      {t('quotaBadge', { n: row.annual_quota_days })}
                    </span>
                  )}
                  {row.advance_notice_days != null && row.advance_notice_days > 0 && (
                    <span className="text-[11px] text-gray-500 dark:text-gray-400">
                      {t('noticeBadge', { n: row.advance_notice_days })}
                    </span>
                  )}
                </div>
              </div>

              <Badge variant={row.active ? 'success' : 'default'} size="sm">
                {row.active ? t('active') : t('inactive')}
              </Badge>
              <button
                type="button"
                onClick={() => openEdit(row)}
                disabled={busy}
                title={t('edit')}
                aria-label={t('edit')}
                className="shrink-0 rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-indigo-600 dark:hover:bg-gray-800 dark:hover:text-indigo-400"
              >
                <Pencil className="h-4 w-4" />
              </button>
              <Button
                size="sm"
                variant={row.active ? 'ghost' : 'outline'}
                onClick={() => toggleActive(row)}
                disabled={busy}
                className="shrink-0"
              >
                {row.active ? t('deactivate') : t('activate')}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <LeaveTypeModal
        open={modalOpen}
        editing={editing}
        companyId={companyId}
        onClose={() => setModalOpen(false)}
        onSaved={fetchRows}
      />
    </div>
  );
}

// ===========================================================================
// Holiday modal (create + edit)
// ===========================================================================

interface HolidayFormState {
  holiday_date: string;
  name_th: string;
  name_en: string;
  is_public_holiday: boolean;
}

const EMPTY_HOLIDAY_FORM: HolidayFormState = {
  holiday_date: '',
  name_th: '',
  name_en: '',
  is_public_holiday: true,
};

interface HolidayModalProps {
  open: boolean;
  editing: HolidayRow | null;
  companyId: string;
  year: number;
  onClose: () => void;
  onSaved: () => void;
}

function HolidayModal({ open, editing, companyId, year, onClose, onSaved }: HolidayModalProps) {
  const t = useTranslations('hr.leaveTypes');
  const [form, setForm] = useState<HolidayFormState>(EMPTY_HOLIDAY_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setForm({
        holiday_date: editing.holiday_date,
        name_th: editing.name_th,
        name_en: editing.name_en,
        is_public_holiday: editing.is_public_holiday,
      });
    } else {
      setForm({ ...EMPTY_HOLIDAY_FORM, holiday_date: `${year}-01-01` });
    }
  }, [open, editing, year]);

  const set = <K extends keyof HolidayFormState>(key: K, value: HolidayFormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const save = async () => {
    if (!form.holiday_date) {
      toast({ type: 'error', title: t('requiredDate') });
      return;
    }
    if (!form.name_th.trim() || !form.name_en.trim()) {
      toast({ type: 'error', title: t('requiredFields') });
      return;
    }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        holiday_date: form.holiday_date,
        name_th: form.name_th.trim(),
        name_en: form.name_en.trim(),
        is_public_holiday: form.is_public_holiday,
      };
      if (!editing) payload.company_id = companyId || null;

      const url = editing ? `/api/hr/holidays/${editing.id}` : '/api/hr/holidays';
      const res = await fetch(url, {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        toast({ type: 'error', title: t('saveFailed'), message: json.error });
        return;
      }
      toast({ type: 'success', title: editing ? t('savedOk') : t('createdOk') });
      onSaved();
      onClose();
    } catch (err) {
      toast({
        type: 'error',
        title: t('saveFailed'),
        message: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title={editing ? t('editHoliday') : t('addHoliday')}
      size="md"
    >
      <div className="space-y-4">
        <Input
          label={t('date')}
          type="date"
          value={form.holiday_date}
          onChange={(e) => set('holiday_date', e.target.value)}
        />
        <Input
          label={t('nameTh')}
          value={form.name_th}
          onChange={(e) => set('name_th', e.target.value)}
        />
        <Input
          label={t('nameEn')}
          value={form.name_en}
          onChange={(e) => set('name_en', e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            checked={form.is_public_holiday}
            onChange={(e) => set('is_public_holiday', e.target.checked)}
          />
          {t('publicHoliday')}
        </label>
      </div>

      <ModalFooter>
        <Button variant="ghost" onClick={onClose} disabled={saving}>
          {t('cancel')}
        </Button>
        <Button onClick={save} isLoading={saving}>
          {t('save')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

// ===========================================================================
// Holidays tab
// ===========================================================================

function HolidaysTab({ companyId }: { companyId: string }) {
  const t = useTranslations('hr.leaveTypes');
  const [year, setYear] = useState<number>(CURRENT_YEAR);
  const [rows, setRows] = useState<HolidayRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<HolidayRow | null>(null);

  const yearOptions = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const y = CURRENT_YEAR - 2 + i;
        return { value: String(y), label: String(y) };
      }),
    [],
  );

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ year: String(year) });
      if (companyId) params.set('company_id', companyId);
      const res = await fetch(`/api/hr/holidays?${params.toString()}`);
      if (res.ok) {
        const json = await res.json();
        setRows((json.data ?? []) as HolidayRow[]);
      } else {
        const json = await res.json().catch(() => ({}));
        toast({ type: 'error', title: t('saveFailed'), message: json.error });
      }
    } catch (err) {
      toast({
        type: 'error',
        title: t('saveFailed'),
        message: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, [companyId, year, t]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const removeHoliday = async (row: HolidayRow) => {
    if (!window.confirm(t('confirmDeleteHoliday', { name: row.name_th }))) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/hr/holidays/${row.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        toast({ type: 'error', title: t('saveFailed'), message: json.error });
        return;
      }
      toast({ type: 'success', title: t('deletedOk') });
      await fetchRows();
    } catch (err) {
      toast({
        type: 'error',
        title: t('saveFailed'),
        message: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  };

  const openAdd = () => {
    setEditing(null);
    setModalOpen(true);
  };
  const openEdit = (row: HolidayRow) => {
    setEditing(row);
    setModalOpen(true);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="w-32">
          <Select
            aria-label={t('year')}
            value={String(year)}
            onChange={(e) => setYear(Number(e.target.value))}
            options={yearOptions}
          />
        </div>
        <Button size="sm" onClick={openAdd}>
          <Plus className="h-4 w-4" />
          {t('addHoliday')}
        </Button>
      </div>

      {loading ? (
        <div className="py-10 text-center text-sm text-gray-400">…</div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title={t('noHolidays')}
          description={t('noHolidaysDesc')}
          action={
            <Button size="sm" onClick={openAdd}>
              <Plus className="h-4 w-4" />
              {t('addHoliday')}
            </Button>
          }
        />
      ) : (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 dark:divide-gray-800 dark:border-gray-700">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-white px-3 py-2.5 dark:bg-gray-900"
            >
              <span className="w-24 shrink-0 text-sm tabular-nums text-gray-500 dark:text-gray-400">
                {row.holiday_date}
              </span>
              <div className="min-w-0 flex-1">
                <span className="font-medium text-gray-900 dark:text-white">{row.name_th}</span>
                <span className="ml-2 text-xs text-gray-400">{row.name_en}</span>
              </div>
              {row.is_public_holiday && (
                <Badge variant="info" size="sm">
                  {t('publicHolidayBadge')}
                </Badge>
              )}
              <button
                type="button"
                onClick={() => openEdit(row)}
                disabled={busy}
                title={t('edit')}
                aria-label={t('edit')}
                className="shrink-0 rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-indigo-600 dark:hover:bg-gray-800 dark:hover:text-indigo-400"
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => removeHoliday(row)}
                disabled={busy}
                title={t('delete')}
                aria-label={t('delete')}
                className="shrink-0 rounded-md p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <HolidayModal
        open={modalOpen}
        editing={editing}
        companyId={companyId}
        year={year}
        onClose={() => setModalOpen(false)}
        onSaved={fetchRows}
      />
    </div>
  );
}

// ===========================================================================
// Page
// ===========================================================================

export default function LeaveTypesPage() {
  const t = useTranslations('hr.leaveTypes');
  const [tab, setTab] = useState<'leaveTypes' | 'holidays'>('leaveTypes');
  const [companies, setCompanies] = useState<CompanyOpt[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [companiesLoading, setCompaniesLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/hr/companies');
        if (res.ok) {
          const json = await res.json();
          const list = (json.data ?? []) as CompanyOpt[];
          setCompanies(list);
          if (list.length) setCompanyId(list[0].id);
        } else {
          const json = await res.json().catch(() => ({}));
          toast({ type: 'error', title: t('saveFailed'), message: json.error });
        }
      } catch (err) {
        toast({
          type: 'error',
          title: t('saveFailed'),
          message: err instanceof Error ? err.message : undefined,
        });
      } finally {
        setCompaniesLoading(false);
      }
    })();
  }, [t]);

  const companyOptions = useMemo(
    () => companies.map((c) => ({ value: c.id, label: c.name })),
    [companies],
  );

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">{t('title')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('subtitle')}</p>
      </div>

      <div className="max-w-xs">
        <Select
          label={t('company')}
          value={companyId}
          onChange={(e) => setCompanyId(e.target.value)}
          options={companyOptions}
          placeholder={companiesLoading ? t('loading') : t('selectCompany')}
        />
      </div>

      <Tabs
        tabs={[
          { id: 'leaveTypes', label: t('tabLeaveTypes') },
          { id: 'holidays', label: t('tabHolidays') },
        ]}
        activeTab={tab}
        onChange={(id) => setTab(id as 'leaveTypes' | 'holidays')}
      />

      {tab === 'leaveTypes' ? (
        <LeaveTypesTab key={`lt-${companyId}`} companyId={companyId} />
      ) : (
        <HolidaysTab key={`hol-${companyId}`} companyId={companyId} />
      )}
    </div>
  );
}
