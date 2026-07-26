'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Shield, UserCog } from 'lucide-react';
import { Badge, Button, Modal, StatusBadge, type StatusTone } from '@/components/ui';
import { formatThaiDate } from '@/lib/utils/format';
import { ROLE_LABELS, type UserRole } from '@/types/roles';

// Read-only "everything about this employee" viewer (owner ask 2026-07-08): opened from the
// person icon on each /hr/employees row. Shows the profile photo + real name / nickname and every
// employment, pay, statutory, and bank field HR needs, fetched from GET /api/hr/employees/[id].
export interface EmployeeDetailSeed {
  id: string;
  employee_code: string | null;
  status: string;
  pay_type: string;
  rate_satang: number;
  profile: { display_name?: string | null; username?: string | null } | null;
  position: { name?: string | null } | null;
  department: { name?: string | null } | null;
  company: { name?: string | null } | null;
  stores: { id: string; store_name: string }[];
}

interface EmployeeDetail {
  full_name: string | null;
  employee_code: string | null;
  status: string;
  pay_type: string;
  rate_satang: number;
  work_hours_per_day: number | null;
  break_hours: number | null;
  ot_eligible: boolean | null;
  start_date: string | null;
  probation_end: string | null;
  birth_date: string | null;
  end_date: string | null;
  end_reason: string | null;
  sso_enrolled: boolean | null;
  sso_no: string | null;
  tax_mode: string | null;
  tax_id: string | null;
  bank_name: string | null;
  bank_account_no: string | null;
  bank_account_name: string | null;
  emergency_contact: string | null;
  notes: string | null;
  profile: { display_name?: string | null; username?: string | null; avatar_url?: string | null; role?: string | null; active?: boolean | null } | null;
  supervisor: { display_name?: string | null } | null;
}

const STATUS_TONE: Record<string, StatusTone> = {
  active: 'good',
  probation: 'warn',
  resigned: 'neutral',
  terminated: 'critical',
};

const bahtFromSatang = (satang: number): string =>
  (satang / 100).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export function EmployeeDetailModal({
  employee,
  onClose,
  onManageAccount,
}: {
  employee: EmployeeDetailSeed | null;
  onClose: () => void;
  /** Jump to the accounts tab prefiltered to this username (merged people surface). */
  onManageAccount?: (username: string) => void;
}) {
  const t = useTranslations('hr.employees');
  const [detail, setDetail] = useState<EmployeeDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setFailed(false);
    setDetail(null);
    try {
      const res = await fetch(`/api/hr/employees/${id}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error('load failed');
      setDetail(json.data as EmployeeDetail);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (employee) load(employee.id);
  }, [employee, load]);

  if (!employee) return null;

  const nickname = detail?.profile?.display_name || employee.profile?.display_name || employee.profile?.username || '—';
  const realName = detail?.full_name || null;
  const avatar = detail?.profile?.avatar_url || null;
  const initial = (nickname || '—').trim().charAt(0).toUpperCase() || '—';
  const stores = employee.stores.map((s) => s.store_name).join(', ') || '—';

  const val = (v: unknown): string => (v == null || v === '' ? '—' : String(v));
  const valDate = (v: string | null): string => (v ? formatThaiDate(v) : '—');
  const yesNo = (v: boolean | null | undefined) => (v ? t('profile.yes') : t('profile.no'));

  return (
    <Modal isOpen onClose={onClose} title={t('detail.title')} size="lg">
      {/* Header — photo + names + status */}
      <div className="flex items-center gap-4 border-b border-gray-100 pb-4 dark:border-gray-700">
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatar} alt="" className="h-16 w-16 shrink-0 rounded-full object-cover ring-2 ring-white dark:ring-gray-800" />
        ) : (
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-2xl font-bold text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-300">
            {initial}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-bold text-gray-900 dark:text-white">{nickname}</p>
          {realName && <p className="truncate text-sm text-gray-500 dark:text-gray-400">{t('detail.realName')}: {realName}</p>}
          <div className="mt-1.5 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <span className="tabular-nums">{employee.employee_code || '—'}</span>
            <StatusBadge tone={STATUS_TONE[employee.status] ?? 'neutral'} label={t(`status.${employee.status}`)} />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-gray-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : failed ? (
        <p className="py-8 text-center text-sm text-red-500">{t('detail.loadFailed')}</p>
      ) : detail ? (
        <div className="max-h-[60vh] space-y-5 overflow-y-auto py-4">
          <Section title={t('profile.job')}>
            <Field label={t('profile.company')} value={val(employee.company?.name)} />
            <Field label={t('profile.department')} value={val(employee.department?.name)} />
            <Field label={t('profile.position')} value={val(employee.position?.name)} />
            <Field label={t('detail.supervisor')} value={val(detail.supervisor?.display_name)} />
            <Field label={t('detail.branch')} value={stores} />
            <Field label={t('profile.payType')} value={t(`payType.${detail.pay_type}`)} />
          </Section>

          <Section title={t('profile.employment')}>
            <Field label={t('profile.status')} value={t(`status.${detail.status}`)} />
            <Field label={t('profile.startDate')} value={valDate(detail.start_date)} />
            <Field label={t('profile.probationEnd')} value={valDate(detail.probation_end)} />
            <Field label={t('detail.birthDate')} value={valDate(detail.birth_date)} />
            {detail.end_date && <Field label={t('detail.endDate')} value={valDate(detail.end_date)} />}
            {detail.end_reason && <Field label={t('detail.endReason')} value={val(detail.end_reason)} />}
          </Section>

          <Section title={t('profile.compensation')}>
            <Field label={t('profile.rate')} value={`฿${bahtFromSatang(detail.rate_satang)}`} />
            <Field label={t('detail.workHours')} value={val(detail.work_hours_per_day)} />
            <Field label={t('detail.breakHours')} value={val(detail.break_hours)} />
            <Field label={t('detail.otEligible')} value={yesNo(detail.ot_eligible)} />
          </Section>

          {/* บัญชีเข้าระบบ — login account + สิทธิ์ระบบ (Role), kept visually apart from the
              job-position fields above so "ตำแหน่งงาน" and "สิทธิ์ระบบ" never blur together. */}
          <Section title={t('detail.account')}>
            <Field label={t('detail.username')} value={detail.profile?.username ? `@${detail.profile.username}` : '—'} />
            <div>
              <dt className="text-xs text-gray-400 dark:text-gray-500">{t('detail.systemRole')}</dt>
              <dd className="mt-0.5 flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" size="sm">
                  <span className="inline-flex items-center gap-1">
                    <Shield className="h-3 w-3" />
                    {detail.profile?.role ? ROLE_LABELS[detail.profile.role as UserRole] || detail.profile.role : '—'}
                  </span>
                </Badge>
                <Badge variant={detail.profile?.active === false ? 'danger' : 'success'} size="sm">
                  {detail.profile?.active === false ? t('detail.accountDisabled') : t('detail.accountActive')}
                </Badge>
              </dd>
            </div>
            {onManageAccount && detail.profile?.username && (
              <div className="sm:col-span-2">
                <Button
                  variant="outline"
                  size="sm"
                  icon={<UserCog className="h-4 w-4" />}
                  onClick={() => onManageAccount(detail.profile!.username!)}
                >
                  {t('detail.manageAccount')}
                </Button>
              </div>
            )}
          </Section>

          <Section title={t('profile.statutory')}>
            <Field label={t('profile.ssoEnrolled')} value={yesNo(detail.sso_enrolled)} />
            <Field label={t('profile.ssoNo')} value={val(detail.sso_no)} />
            <Field label={t('profile.taxMode')} value={val(detail.tax_mode)} />
            <Field label={t('profile.taxId')} value={val(detail.tax_id)} />
          </Section>

          <Section title={t('detail.bank')}>
            <Field label={t('detail.bankName')} value={val(detail.bank_name)} />
            <Field label={t('detail.bankAccountNo')} value={val(detail.bank_account_no)} />
            <Field label={t('detail.bankAccountName')} value={val(detail.bank_account_name)} />
          </Section>

          {(detail.emergency_contact || detail.notes) && (
            <Section title={t('detail.other')}>
              {detail.emergency_contact && <Field label={t('detail.emergencyContact')} value={val(detail.emergency_contact)} wide />}
              {detail.notes && <Field label={t('detail.notes')} value={val(detail.notes)} wide />}
            </Section>
          )}
        </div>
      ) : null}
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">{title}</h3>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2">{children}</dl>
    </div>
  );
}

function Field({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <dt className="text-xs text-gray-400 dark:text-gray-500">{label}</dt>
      <dd className="text-sm font-medium text-gray-800 dark:text-gray-200">{value}</dd>
    </div>
  );
}
