'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Modal, Input, Select, Button, Textarea, toast } from '@/components/ui';
import { cn } from '@/lib/utils/cn';
import { createClient } from '@/lib/supabase/client';
import {
  PAY_TYPES,
  TAX_MODES,
  EMPLOYEE_STATUSES,
  WORK_HOURS_PER_DAY,
  OT_HOUR_DIVISORS,
  STANDARD_DAYS_OFF,
  isPartTime,
  type EmployeeDocument,
  type DocumentType,
} from '@/lib/hr/employees';

interface EmployeeFormModalProps {
  isOpen: boolean;
  employeeId: string | null;
  onClose: () => void;
  onSaved: () => void;
}

interface RefOpt {
  id: string;
  name: string;
}

interface FormState {
  // account (create only)
  username: string;
  display_name: string;
  role: string;
  // employment
  company_id: string;
  position_id: string;
  department_id: string;
  supervisor_id: string;
  employee_code: string;
  start_date: string;
  status: string;
  // pay & hours
  pay_type: string;
  rate_baht: string;
  work_hours_per_day: string;
  break_hours: string;
  ot_eligible: boolean;
  ot_hour_divisor: string;
  standard_days_off: string;
  // tax & sso
  tax_mode: string;
  sso_enrolled: boolean;
  sso_no: string;
  tax_id: string;
  // bank
  bank_name: string;
  bank_account_no: string;
  bank_account_name: string;
  // emergency contact
  em_name: string;
  em_phone: string;
  em_relation: string;
  // venues
  storeIds: string[];
  // edit-only reason
  reason: string;
}

interface SensitiveSnapshot {
  rate_satang: number;
  bank_name: string | null;
  bank_account_no: string | null;
  bank_account_name: string | null;
  sso_no: string | null;
  tax_id: string | null;
}

const ROLE_OPTIONS = ['staff', 'bar', 'manager', 'technician', 'hq', 'accountant'] as const;
const DOC_SLOTS: DocumentType[] = ['id_card', 'signature', 'contract'];

function defaultForm(): FormState {
  return {
    username: '',
    display_name: '',
    role: 'staff',
    company_id: '',
    position_id: '',
    department_id: '',
    supervisor_id: '',
    employee_code: '',
    start_date: '',
    status: 'active',
    pay_type: 'full_monthly',
    rate_baht: '',
    work_hours_per_day: '8',
    break_hours: '1',
    ot_eligible: false,
    ot_hour_divisor: '8',
    standard_days_off: '8',
    tax_mode: 'progressive',
    sso_enrolled: true,
    sso_no: '',
    tax_id: '',
    bank_name: '',
    bank_account_no: '',
    bank_account_name: '',
    em_name: '',
    em_phone: '',
    em_relation: '',
    storeIds: [],
    reason: '',
  };
}

function rateHintKey(payType: string): 'rateHintFull' | 'rateHintHourly' | 'rateHintDaily' {
  if (payType === 'pt_hourly') return 'rateHintHourly';
  if (payType === 'pt_daily') return 'rateHintDaily';
  return 'rateHintFull';
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function EmployeeFormModal({ isOpen, employeeId, onClose, onSaved }: EmployeeFormModalProps) {
  const t = useTranslations('hr.employees.form');
  const tp = useTranslations('hr.employees');
  const tc = useTranslations('common');

  const isCreate = employeeId === null;

  const [form, setForm] = useState<FormState>(defaultForm);
  const [documents, setDocuments] = useState<EmployeeDocument[]>([]);
  const [originalSensitive, setOriginalSensitive] = useState<SensitiveSnapshot | null>(null);

  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [createdPassword, setCreatedPassword] = useState<string | null>(null);
  const [createdWarnings, setCreatedWarnings] = useState<string[]>([]);

  // dropdown option data
  const [companies, setCompanies] = useState<RefOpt[]>([]);
  const [positions, setPositions] = useState<RefOpt[]>([]);
  const [departments, setDepartments] = useState<RefOpt[]>([]);
  const [stores, setStores] = useState<RefOpt[]>([]);
  const [supervisors, setSupervisors] = useState<RefOpt[]>([]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  // Load dropdown data once on mount (component stays mounted with the page).
  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const [co, pos, dep, st, sup] = await Promise.all([
        supabase.from('hr_companies').select('id,name').eq('active', true),
        supabase.from('hr_positions').select('id,name').eq('active', true).order('sort_order'),
        supabase.from('hr_departments').select('id,name').eq('active', true),
        supabase.from('stores').select('id,store_name').eq('active', true),
        supabase.from('profiles').select('id,display_name,username').eq('active', true),
      ]);
      setCompanies((co.data ?? []).map((r) => ({ id: r.id as string, name: r.name as string })));
      setPositions((pos.data ?? []).map((r) => ({ id: r.id as string, name: r.name as string })));
      setDepartments((dep.data ?? []).map((r) => ({ id: r.id as string, name: r.name as string })));
      setStores((st.data ?? []).map((r) => ({ id: r.id as string, name: r.store_name as string })));
      setSupervisors(
        (sup.data ?? []).map((r) => ({
          id: r.id as string,
          name: (r.display_name as string) || (r.username as string) || '—',
        }))
      );
    })();
  }, []);

  // Reset / prefill whenever the modal opens or the target employee changes.
  useEffect(() => {
    if (!isOpen) return;
    setCreatedPassword(null);
    setCreatedWarnings([]);
    setSubmitting(false);
    setUploading(null);
    if (employeeId === null) {
      setForm(defaultForm());
      setDocuments([]);
      setOriginalSensitive(null);
      setLoading(false);
    } else {
      void loadEmployee(employeeId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, employeeId]);

  async function loadEmployee(id: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/hr/employees/${id}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.data) {
        toast({ type: 'error', title: t('loadFailed'), message: typeof json.error === 'string' ? json.error : undefined });
        onClose();
        return;
      }
      const d = json.data as Record<string, unknown>;
      const profile = (d.profile ?? {}) as { display_name?: string | null; username?: string | null };
      const ec = (d.emergency_contact && typeof d.emergency_contact === 'object'
        ? d.emergency_contact
        : {}) as { name?: string; phone?: string; relation?: string };

      setForm({
        username: profile.username ?? '',
        display_name: profile.display_name ?? '',
        role: 'staff',
        company_id: (d.company_id as string) ?? '',
        position_id: (d.position_id as string) ?? '',
        department_id: (d.department_id as string) ?? '',
        supervisor_id: (d.supervisor_id as string) ?? '',
        employee_code: (d.employee_code as string) ?? '',
        start_date: (d.start_date as string) ?? '',
        status: (d.status as string) ?? 'active',
        pay_type: (d.pay_type as string) ?? 'full_monthly',
        rate_baht: d.rate_satang != null ? String((d.rate_satang as number) / 100) : '',
        work_hours_per_day: String((d.work_hours_per_day as number) ?? 8),
        break_hours: String((d.break_hours as number) ?? 0),
        ot_eligible: Boolean(d.ot_eligible),
        ot_hour_divisor: String((d.ot_hour_divisor as number) ?? 8),
        standard_days_off: String((d.standard_days_off as number) ?? 8),
        tax_mode: (d.tax_mode as string) ?? 'progressive',
        sso_enrolled: Boolean(d.sso_enrolled),
        sso_no: (d.sso_no as string) ?? '',
        tax_id: (d.tax_id as string) ?? '',
        bank_name: (d.bank_name as string) ?? '',
        bank_account_no: (d.bank_account_no as string) ?? '',
        bank_account_name: (d.bank_account_name as string) ?? '',
        em_name: ec.name ?? '',
        em_phone: ec.phone ?? '',
        em_relation: ec.relation ?? '',
        storeIds: [],
        reason: '',
      });
      setDocuments(Array.isArray(d.documents) ? (d.documents as EmployeeDocument[]) : []);
      setOriginalSensitive({
        rate_satang: (d.rate_satang as number) ?? 0,
        bank_name: (d.bank_name as string) ?? null,
        bank_account_no: (d.bank_account_no as string) ?? null,
        bank_account_name: (d.bank_account_name as string) ?? null,
        sso_no: (d.sso_no as string) ?? null,
        tax_id: (d.tax_id as string) ?? null,
      });
    } catch {
      toast({ type: 'error', title: t('loadFailed') });
      onClose();
    } finally {
      setLoading(false);
    }
  }

  // Part-time forcing (mirrors the server): 3% withholding, no SSO, no OT.
  const partTime = isPartTime(form.pay_type);
  const effTaxMode = partTime ? 'withholding_3pct' : form.tax_mode;
  const effSso = partTime ? false : form.sso_enrolled;
  const effOt = partTime ? false : form.ot_eligible;

  const docOf = (type: DocumentType) => documents.find((d) => d.type === type);
  const removeDoc = (type: DocumentType) => setDocuments((prev) => prev.filter((d) => d.type !== type));

  async function uploadDoc(type: DocumentType, file: File) {
    setUploading(type);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('employeeId', employeeId ?? 'new');
      const res = await fetch('/api/hr/documents', { method: 'POST', body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ type: 'error', title: t('saveFailed'), message: typeof json.error === 'string' ? json.error : undefined });
        return;
      }
      setDocuments((prev) => [
        ...prev.filter((d) => d.type !== type),
        { type, path: json.path as string, name: json.name as string, uploaded_at: new Date().toISOString() },
      ]);
    } catch {
      toast({ type: 'error', title: t('saveFailed') });
    } finally {
      setUploading(null);
    }
  }

  async function viewDoc(path: string) {
    try {
      const res = await fetch(`/api/hr/documents?path=${encodeURIComponent(path)}`);
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.url) window.open(json.url as string, '_blank', 'noopener');
      else toast({ type: 'error', title: t('loadFailed'), message: typeof json.error === 'string' ? json.error : undefined });
    } catch {
      toast({ type: 'error', title: t('loadFailed') });
    }
  }

  const toggleStore = (id: string) =>
    setForm((f) => ({
      ...f,
      storeIds: f.storeIds.includes(id) ? f.storeIds.filter((x) => x !== id) : [...f.storeIds, id],
    }));

  function buildEmergency(): { name: string; phone: string; relation: string } | null {
    const name = form.em_name.trim();
    const phone = form.em_phone.trim();
    const relation = form.em_relation.trim();
    if (!name && !phone && !relation) return null;
    return { name, phone, relation };
  }

  function hasRequiredPartTimeDocs(): boolean {
    const types = new Set(documents.map((d) => d.type));
    return types.has('id_card') && types.has('signature');
  }

  async function handleSubmit() {
    const rateSatang = Math.round((parseFloat(form.rate_baht) || 0) * 100);

    // Validation (mirrors server rules).
    if (isCreate) {
      const username = form.username.trim().toLowerCase();
      if (!/^[a-z0-9._-]{3,}$/.test(username)) {
        toast({ type: 'error', title: t('requiredUsername') });
        return;
      }
    }
    if (partTime && !hasRequiredPartTimeDocs()) {
      toast({ type: 'error', title: t('requiredDocs') });
      return;
    }

    const common = {
      display_name: form.display_name.trim() || null,
      position_id: form.position_id || null,
      department_id: form.department_id || null,
      supervisor_id: form.supervisor_id || null,
      employee_code: form.employee_code.trim() || null,
      pay_type: form.pay_type,
      work_hours_per_day: Number(form.work_hours_per_day),
      break_hours: Number(form.break_hours) || 0,
      ot_eligible: effOt,
      ot_hour_divisor: Number(form.ot_hour_divisor),
      standard_days_off: Number(form.standard_days_off),
      tax_mode: effTaxMode,
      sso_enrolled: effSso,
      emergency_contact: buildEmergency(),
      documents,
      start_date: form.start_date || null,
      status: form.status,
    };

    let url: string;
    let method: string;
    let body: Record<string, unknown>;

    if (isCreate) {
      url = '/api/hr/employees';
      method = 'POST';
      body = {
        username: form.username.trim().toLowerCase(),
        role: form.role,
        storeIds: form.storeIds,
        company_id: form.company_id || null,
        rate_satang: rateSatang,
        bank_name: form.bank_name.trim() || null,
        bank_account_no: form.bank_account_no.trim() || null,
        bank_account_name: form.bank_account_name.trim() || null,
        sso_no: form.sso_no.trim() || null,
        tax_id: form.tax_id.trim() || null,
        ...common,
      };
    } else {
      // EDIT: never send company_id (transfer is a separate flow); only send
      // sensitive fields when they actually changed so we don't force a reason.
      url = `/api/hr/employees/${employeeId}`;
      method = 'PUT';
      body = { ...common };
      const snap = originalSensitive;
      if (!snap || rateSatang !== snap.rate_satang) body.rate_satang = rateSatang;
      const bankName = form.bank_name.trim() || null;
      const bankNo = form.bank_account_no.trim() || null;
      const bankAcc = form.bank_account_name.trim() || null;
      const ssoNo = form.sso_no.trim() || null;
      const taxId = form.tax_id.trim() || null;
      if (!snap || bankName !== snap.bank_name) body.bank_name = bankName;
      if (!snap || bankNo !== snap.bank_account_no) body.bank_account_no = bankNo;
      if (!snap || bankAcc !== snap.bank_account_name) body.bank_account_name = bankAcc;
      if (!snap || ssoNo !== snap.sso_no) body.sso_no = ssoNo;
      if (!snap || taxId !== snap.tax_id) body.tax_id = taxId;

      const sensitiveKeys = ['rate_satang', 'bank_name', 'bank_account_no', 'bank_account_name', 'sso_no', 'tax_id'];
      const sensitiveChanged = sensitiveKeys.some((k) => k in body);
      if (sensitiveChanged) {
        if (!form.reason.trim()) {
          toast({ type: 'error', title: t('requiredReason') });
          return;
        }
        body.reason = form.reason.trim();
      }
    }

    setSubmitting(true);
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ type: 'error', title: t('saveFailed'), message: typeof json.error === 'string' ? json.error : undefined });
        setSubmitting(false);
        return;
      }
      if (isCreate) {
        const pwd = typeof json.tempPassword === 'string' ? json.tempPassword : '';
        toast({ type: 'success', title: t('createdOk'), message: `${t('tempPasswordMsg')} ${pwd}` });
        setCreatedWarnings(Array.isArray(json.warnings) ? (json.warnings as string[]) : []);
        setCreatedPassword(pwd);
        setSubmitting(false);
      } else {
        toast({ type: 'success', title: t('savedOk') });
        onSaved();
      }
    } catch (e) {
      toast({ type: 'error', title: t('saveFailed'), message: e instanceof Error ? e.message : undefined });
      setSubmitting(false);
    }
  }

  const refOptions = (items: RefOpt[]) => [
    { value: '', label: t('none') },
    ...items.map((i) => ({ value: i.id, label: i.name })),
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isCreate ? t('createTitle') : t('editTitle')}
      size="full"
    >
      {createdPassword !== null ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-700 dark:bg-emerald-900/20">
            <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">{t('tempPasswordTitle')}</p>
            <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-400">{t('tempPasswordMsg')}</p>
            <div className="mt-2 select-all rounded-md bg-white px-3 py-2 text-center font-mono text-lg font-bold tracking-wider text-gray-900 dark:bg-gray-900 dark:text-white">
              {createdPassword || '—'}
            </div>
            {createdWarnings.length > 0 && (
              <ul className="mt-3 list-disc space-y-0.5 pl-5 text-xs text-amber-600 dark:text-amber-400">
                {createdWarnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex justify-end">
            <Button type="button" onClick={onSaved}>
              {tc('close')}
            </Button>
          </div>
        </div>
      ) : loading ? (
        <div className="py-16 text-center text-sm text-gray-500 dark:text-gray-400">{tc('loading')}</div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {/* Account (create only) */}
          {isCreate && (
            <>
              <SectionHeader>{t('secAccount')}</SectionHeader>
              <Input
                label={t('username')}
                value={form.username}
                onChange={(e) => update('username', e.target.value.toLowerCase())}
                placeholder="jane.doe"
                autoComplete="off"
              />
              <Input
                label={t('displayName')}
                value={form.display_name}
                onChange={(e) => update('display_name', e.target.value)}
              />
              <Select
                label={t('role')}
                value={form.role}
                onChange={(e) => update('role', e.target.value)}
                options={ROLE_OPTIONS.map((r) => ({ value: r, label: capitalize(r) }))}
              />
            </>
          )}

          {/* Employment */}
          <SectionHeader>{t('secEmployment')}</SectionHeader>
          {!isCreate && (
            <Input label={t('displayName')} value={form.display_name} onChange={(e) => update('display_name', e.target.value)} />
          )}
          <Select
            label={t('company')}
            value={form.company_id}
            onChange={(e) => update('company_id', e.target.value)}
            disabled={!isCreate}
            options={refOptions(companies)}
          />
          <Select
            label={t('position')}
            value={form.position_id}
            onChange={(e) => update('position_id', e.target.value)}
            options={refOptions(positions)}
          />
          <Select
            label={t('department')}
            value={form.department_id}
            onChange={(e) => update('department_id', e.target.value)}
            options={refOptions(departments)}
          />
          <Select
            label={t('supervisor')}
            value={form.supervisor_id}
            onChange={(e) => update('supervisor_id', e.target.value)}
            options={refOptions(supervisors)}
          />
          <Input
            label={t('employeeCode')}
            value={form.employee_code}
            onChange={(e) => update('employee_code', e.target.value)}
          />
          <Input
            type="date"
            label={t('startDate')}
            value={form.start_date}
            onChange={(e) => update('start_date', e.target.value)}
          />
          <Select
            label={tc('status')}
            value={form.status}
            onChange={(e) => update('status', e.target.value)}
            options={EMPLOYEE_STATUSES.map((s) => ({ value: s, label: tp(`status.${s}`) }))}
          />

          {/* Pay & hours */}
          <SectionHeader>{t('secPay')}</SectionHeader>
          <Select
            label={tp('col.payType')}
            value={form.pay_type}
            onChange={(e) => update('pay_type', e.target.value)}
            options={PAY_TYPES.map((p) => ({ value: p, label: tp(`payType.${p}`) }))}
          />
          <Input
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            label={t('rate')}
            hint={t(rateHintKey(form.pay_type))}
            value={form.rate_baht}
            onChange={(e) => update('rate_baht', e.target.value)}
          />
          <Select
            label={t('workHours')}
            value={form.work_hours_per_day}
            onChange={(e) => update('work_hours_per_day', e.target.value)}
            options={WORK_HOURS_PER_DAY.map((h) => ({ value: String(h), label: String(h) }))}
          />
          <Input
            type="number"
            min={0}
            step="0.5"
            label={t('breakHours')}
            value={form.break_hours}
            onChange={(e) => update('break_hours', e.target.value)}
          />
          <Select
            label={t('otDivisor')}
            value={form.ot_hour_divisor}
            onChange={(e) => update('ot_hour_divisor', e.target.value)}
            disabled={partTime}
            options={OT_HOUR_DIVISORS.map((h) => ({ value: String(h), label: String(h) }))}
          />
          <Select
            label={t('daysOff')}
            value={form.standard_days_off}
            onChange={(e) => update('standard_days_off', e.target.value)}
            options={STANDARD_DAYS_OFF.map((d) => ({ value: String(d), label: String(d) }))}
          />
          <label className="col-span-full flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={effOt}
              disabled={partTime}
              onChange={(e) => update('ot_eligible', e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-60 dark:border-gray-600"
            />
            {t('otEligible')}
          </label>

          {partTime && (
            <div className="col-span-full rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
              {t('partTimeNotice')}
            </div>
          )}

          {/* Tax & SSO */}
          <SectionHeader>{t('secTax')}</SectionHeader>
          <Select
            label={t('taxMode')}
            value={effTaxMode}
            onChange={(e) => update('tax_mode', e.target.value)}
            disabled={partTime}
            options={TAX_MODES.map((m) => ({ value: m, label: tp(`taxModeOpt.${m}`) }))}
          />
          <div className="flex items-end">
            <label className="flex items-center gap-2 pb-2.5 text-sm text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={effSso}
                disabled={partTime}
                onChange={(e) => update('sso_enrolled', e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-60 dark:border-gray-600"
              />
              {t('ssoEnrolled')}
            </label>
          </div>
          <Input label={t('ssoNo')} value={form.sso_no} onChange={(e) => update('sso_no', e.target.value)} />
          <Input label={t('taxId')} value={form.tax_id} onChange={(e) => update('tax_id', e.target.value)} />

          {/* Bank */}
          <SectionHeader>{t('secBank')}</SectionHeader>
          <Input label={t('bankName')} value={form.bank_name} onChange={(e) => update('bank_name', e.target.value)} />
          <Input
            label={t('bankAccountNo')}
            value={form.bank_account_no}
            onChange={(e) => update('bank_account_no', e.target.value)}
          />
          <Input
            label={t('bankAccountName')}
            value={form.bank_account_name}
            onChange={(e) => update('bank_account_name', e.target.value)}
          />

          {/* Emergency contact */}
          <SectionHeader>{t('secEmergency')}</SectionHeader>
          <Input label={t('emName')} value={form.em_name} onChange={(e) => update('em_name', e.target.value)} />
          <Input label={t('emPhone')} value={form.em_phone} onChange={(e) => update('em_phone', e.target.value)} />
          <Input label={t('emRelation')} value={form.em_relation} onChange={(e) => update('em_relation', e.target.value)} />

          {/* Documents */}
          <SectionHeader>{t('secDocs')}</SectionHeader>
          <div className="col-span-full grid grid-cols-1 gap-3 sm:grid-cols-3">
            {DOC_SLOTS.map((type) => (
              <DocSlot
                key={type}
                label={t(type === 'id_card' ? 'idCard' : type === 'signature' ? 'signature' : 'contract')}
                type={type}
                required={partTime && type !== 'contract'}
                doc={docOf(type)}
                uploading={uploading === type}
                onUpload={uploadDoc}
                onView={viewDoc}
                onRemove={removeDoc}
                labels={{ upload: t('docUpload'), uploading: t('docUploading'), view: t('docView'), remove: t('docRemove') }}
              />
            ))}
          </div>

          {/* Venues (create only — venue assignment is not part of the edit endpoint) */}
          {isCreate && (
            <>
              <SectionHeader>{t('secVenues')}</SectionHeader>
              <div className="col-span-full grid grid-cols-2 gap-2 sm:grid-cols-3">
                {stores.map((s) => (
                  <label
                    key={s.id}
                    className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 dark:border-gray-700 dark:text-gray-300"
                  >
                    <input
                      type="checkbox"
                      checked={form.storeIds.includes(s.id)}
                      onChange={() => toggleStore(s.id)}
                      className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 dark:border-gray-600"
                    />
                    <span className="truncate">{s.name}</span>
                  </label>
                ))}
              </div>
            </>
          )}

          {/* Reason (edit only) */}
          {!isCreate && (
            <>
              <SectionHeader>{t('reason')}</SectionHeader>
              <div className="col-span-full">
                <Textarea
                  label={t('reason')}
                  hint={t('reasonHint')}
                  rows={2}
                  value={form.reason}
                  onChange={(e) => update('reason', e.target.value)}
                />
              </div>
            </>
          )}

          {/* Footer actions */}
          <div className="col-span-full mt-2 flex justify-end gap-3 border-t border-gray-100 pt-4 dark:border-gray-700">
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              {t('cancel')}
            </Button>
            <Button type="button" onClick={handleSubmit} isLoading={submitting}>
              {submitting ? (isCreate ? t('creating') : t('saving')) : t('save')}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="col-span-full mt-3 border-b border-gray-100 pb-1 text-sm font-semibold text-gray-700 first:mt-0 dark:border-gray-700 dark:text-gray-200">
      {children}
    </h3>
  );
}

interface DocSlotProps {
  label: string;
  type: DocumentType;
  required: boolean;
  doc?: EmployeeDocument;
  uploading: boolean;
  onUpload: (type: DocumentType, file: File) => void;
  onView: (path: string) => void;
  onRemove: (type: DocumentType) => void;
  labels: { upload: string; uploading: string; view: string; remove: string };
}

function DocSlot({ label, type, required, doc, uploading, onUpload, onView, onRemove, labels }: DocSlotProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className={cn('rounded-lg border p-3', 'border-gray-200 dark:border-gray-700')}>
      <div className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </div>
      {doc ? (
        <div className="space-y-2">
          <div className="truncate text-xs text-gray-500 dark:text-gray-400" title={doc.name || doc.path}>
            {doc.name || doc.path.split('/').pop()}
          </div>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => onView(doc.path)}>
              {labels.view}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => onRemove(type)}>
              {labels.remove}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUpload(type, f);
              if (inputRef.current) inputRef.current.value = '';
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            isLoading={uploading}
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? labels.uploading : labels.upload}
          </Button>
        </>
      )}
    </div>
  );
}
