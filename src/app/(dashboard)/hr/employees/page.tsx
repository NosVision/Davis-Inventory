'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, ArrowLeftRight, History, Printer, IdCard, Archive, UserRound, Link2, Users, Shield, UserCog, Banknote, Clock } from 'lucide-react';
import { Button, Select, Badge, PageHeader, StatusBadge, Modal, ModalFooter, type StatusTone, toast } from '@/components/ui';
import { DataTable, type Column } from '@/components/data/data-table';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils/cn';
import { ROLE_LABELS, type UserRole } from '@/types/roles';
import { EmployeeFormModal } from './_components/employee-form-modal';
import { TransferModal } from './_components/transfer-modal';
import { EmployeeHistoryModal } from './_components/employee-history-modal';
import { EmployeePayHistoryModal } from './_components/employee-pay-history-modal';
import { EmployeeDetailModal } from './_components/employee-detail-modal';
import { UsersManager } from './_components/users-manager';
import { InviteLinksManager } from './_components/invite-links-manager';

interface Ref {
  id: string;
  name: string;
}
interface EmployeeRow extends Record<string, unknown> {
  id: string;
  profile_id: string;
  employee_code: string | null;
  full_name: string | null;
  rate_satang: number;
  pay_type: string;
  status: string;
  work_hours_per_day: number | null;
  break_hours: number | null;
  bank_name: string | null;
  bank_account_no: string | null;
  profile: { display_name?: string | null; username?: string | null; role?: string | null; active?: boolean | null } | null;
  position: { name?: string | null } | null;
  department: { name?: string | null } | null;
  company: { name?: string | null } | null;
  stores: { id: string; store_name: string }[];
}

// Printable register columns, in print order. Bank columns default OFF — they carry
// sensitive data, so HR opts in per print (client ask 2026-07-23).
const REGISTER_COLS = [
  { key: 'code', defaultOn: true },
  { key: 'name', defaultOn: true },
  { key: 'position', defaultOn: true },
  { key: 'department', defaultOn: true },
  { key: 'store', defaultOn: true },
  { key: 'pay_type', defaultOn: true },
  { key: 'rate', defaultOn: true },
  { key: 'status', defaultOn: true },
  { key: 'bank_name', defaultOn: false },
  { key: 'bank_account_no', defaultOn: false },
] as const;
type RegisterColKey = (typeof REGISTER_COLS)[number]['key'];

const PAY_TYPES = ['full_monthly', 'pt_hourly', 'pt_daily', 'pt_monthly'];
const STATUSES = ['active', 'probation', 'resigned', 'terminated'];

const STATUS_TONE: Record<string, StatusTone> = {
  active: 'good',
  probation: 'warn',
  resigned: 'neutral',
  terminated: 'critical',
};

function bahtFromSatang(satang: number): string {
  return (satang / 100).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// Prefer the employee's real full name (ชื่อ-นามสกุล); fall back to the profile nickname/
// username only when full_name is unset (e.g. an unlinked/test account).
function employeeName(e: EmployeeRow): string {
  return e.full_name?.trim() || e.profile?.display_name || e.profile?.username || '—';
}

// The merged "people" surface: HR employee registry + user accounts (formerly /users) +
// onboarding links (ลิงก์สมัคร/ลิงก์เชิญ, formerly a modal + /users/invitations) as three
// tabs, so one person is managed in one place. Deep-linkable: ?tab=accounts[&q=<search>], ?tab=links.
type PeopleTab = 'employees' | 'accounts' | 'links';

export default function EmployeesPage() {
  const t = useTranslations('hr.employees');

  // Tab + seed for the accounts search (read off window.location so no Suspense boundary is
  // needed — same pattern as /hr/timesheet deep links). `accountsSeed` also remounts the
  // accounts tab when the detail modal jumps to a specific username.
  const [tab, setTab] = useState<PeopleTab>('employees');
  const [accountsSeed, setAccountsSeed] = useState('');
  // ?view=claims opens the accounts tab straight into the merged identity-claims workflow
  // (formerly /hr/identity-claims — hub badge chips and old links land here).
  const [accountsClaims, setAccountsClaims] = useState(false);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const tp = p.get('tab');
    if (tp === 'accounts' || tp === 'links') {
      if (tp === 'accounts') {
        setAccountsSeed(p.get('q') ?? '');
        setAccountsClaims(p.get('view') === 'claims');
      }
      setTab(tp);
    }
  }, []);
  const switchTab = (next: PeopleTab, seed = '') => {
    setAccountsSeed(seed);
    setAccountsClaims(false);
    setTab(next);
    const qs =
      next === 'accounts' ? `?tab=accounts${seed ? `&q=${encodeURIComponent(seed)}` : ''}`
      : next === 'links' ? '?tab=links'
      : '';
    window.history.replaceState(null, '', `/hr/employees${qs}`);
  };

  const [rows, setRows] = useState<EmployeeRow[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);

  // filters
  const [q, setQ] = useState('');
  const [storeId, setStoreId] = useState('');
  // Payroll is keyed on the legal entity, not the venue — office staff have a company but no store,
  // so filtering by venue alone could never reach them.
  const [companyId, setCompanyId] = useState('');
  const [positionId, setPositionId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [payType, setPayType] = useState('');
  const [status, setStatus] = useState('');

  // filter option data
  const [stores, setStores] = useState<Ref[]>([]);
  const [companies, setCompanies] = useState<Ref[]>([]);
  const [positions, setPositions] = useState<Ref[]>([]);
  const [departments, setDepartments] = useState<Ref[]>([]);

  // form modal
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  // transfer modal
  const [transfer, setTransfer] = useState<{ id: string; companyId: string | null; companyName: string | null } | null>(null);
  // salary/position history modal
  const [historyFor, setHistoryFor] = useState<{ id: string; name: string } | null>(null);
  const [payHistoryFor, setPayHistoryFor] = useState<{ id: string; name: string } | null>(null);
  const [detailFor, setDetailFor] = useState<EmployeeRow | null>(null);
  const [printing, setPrinting] = useState(false);
  // print-register modal: company scope (default '' = every company) + column picks
  const [printOpen, setPrintOpen] = useState(false);
  const [printCompany, setPrintCompany] = useState('');
  const [printCols, setPrintCols] = useState<Record<RegisterColKey, boolean>>(
    () => Object.fromEntries(REGISTER_COLS.map((c) => [c.key, c.defaultOn])) as Record<RegisterColKey, boolean>
  );
  const [profilePrintId, setProfilePrintId] = useState<string | null>(null);

  const printProfile = async (e: EmployeeRow) => {
    setProfilePrintId(e.id);
    try {
      const res = await fetch(`/api/hr/employees/${e.id}`);
      const d = (await res.json())?.data as Record<string, unknown> | undefined;
      if (!res.ok || !d) { toast({ type: 'error', title: t('profile.fail') }); return; }
      const { buildEmployeeProfilePdf, downloadBlob } = await import('./_components/employee-profile-pdf');
      const s = (v: unknown) => (v == null || v === '' ? '' : String(v));
      const name = employeeName(e);
      const now = new Date();
      const blob = await buildEmployeeProfilePdf({
        doc_title: t('profile.docTitle'),
        name,
        code_status: `${e.employee_code || '—'} · ${t(`status.${e.status}`)}`,
        generated_label: new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(now),
        sections: [
          { title: t('profile.job'), fields: [
            { label: t('profile.position'), value: s(e.position?.name) },
            { label: t('profile.department'), value: s(e.department?.name) },
            { label: t('profile.company'), value: s(e.company?.name) },
            { label: t('profile.stores'), value: e.stores.length ? e.stores.map((x) => x.store_name).join(', ') : '' },
            { label: t('profile.payType'), value: t(`payType.${e.pay_type}`) },
          ] },
          { title: t('profile.employment'), fields: [
            { label: t('profile.status'), value: t(`status.${e.status}`) },
            { label: t('profile.startDate'), value: s(d.start_date) },
            { label: t('profile.probationEnd'), value: s(d.probation_end) },
          ] },
          { title: t('profile.compensation'), fields: [
            { label: t('profile.rate'), value: bahtFromSatang(e.rate_satang) },
          ] },
          { title: t('profile.statutory'), fields: [
            { label: t('profile.ssoEnrolled'), value: d.sso_enrolled ? t('profile.yes') : t('profile.no') },
            { label: t('profile.ssoNo'), value: s(d.sso_no) },
            { label: t('profile.taxMode'), value: s(d.tax_mode) },
            { label: t('profile.taxId'), value: s(d.tax_id) },
          ] },
        ],
      });
      downloadBlob(blob, `employee-profile-${e.employee_code || e.id.slice(0, 8)}.pdf`);
      toast({ type: 'success', title: t('profile.done') });
    } catch {
      toast({ type: 'error', title: t('profile.fail') });
    } finally {
      setProfilePrintId(null);
    }
  };

  // Header label per printable column (register.* keys).
  const registerColLabel = (key: RegisterColKey): string =>
    key === 'pay_type' ? t('register.pay')
    : key === 'bank_name' ? t('register.bank')
    : key === 'bank_account_no' ? t('register.bankAccount')
    : t(`register.${key}`);

  const openPrintModal = () => {
    setPrintCompany(''); // spec: default = every company, regardless of the list filter
    setPrintCols(Object.fromEntries(REGISTER_COLS.map((c) => [c.key, c.defaultOn])) as Record<RegisterColKey, boolean>);
    setPrintOpen(true);
  };

  const printRegister = async () => {
    const columns = REGISTER_COLS.map((c) => c.key).filter((k) => printCols[k]);
    if (columns.length === 0) return;
    setPrinting(true);
    try {
      // Fresh fetch — the on-screen list is paginated (50) and may be company-filtered;
      // the register prints the modal's company choice in full (API cap 200).
      const params = new URLSearchParams({ limit: '200' });
      if (printCompany) params.set('company_id', printCompany);
      const res = await fetch(`/api/hr/employees?${params.toString()}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error();
      const printRows = (json.data ?? []) as EmployeeRow[];
      if (printRows.length === 0) {
        toast({ type: 'warning', title: t('register.emptyResult') });
        return;
      }

      const { buildEmployeeRegisterPdf, downloadBlob } = await import('./_components/employee-register-pdf');
      const companyName = printCompany
        ? companies.find((c) => c.id === printCompany)?.name || t('register.allCompanies')
        : t('register.allCompanies');
      const now = new Date();
      const generated = new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(now);
      const blob = await buildEmployeeRegisterPdf({
        company_name: companyName,
        generated_label: generated,
        headcount: printRows.length,
        columns,
        rows: printRows.map((r) => ({
          code: r.employee_code || '',
          name: employeeName(r),
          position: r.position?.name || '—',
          department: r.department?.name || '—',
          store: r.stores.length ? r.stores.map((s) => s.store_name).join(', ') : '—',
          pay_type: t(`payType.${r.pay_type}`),
          rate: bahtFromSatang(r.rate_satang),
          status: t(`status.${r.status}`),
          bank_name: r.bank_name || '—',
          bank_account_no: r.bank_account_no || '—',
        })),
        labels: {
          title: t('register.title'),
          no: t('register.no'),
          headcount: t('register.headcount'),
          page: t('register.page'),
          cols: Object.fromEntries(
            REGISTER_COLS.map((c) => [c.key, registerColLabel(c.key)])
          ) as Record<RegisterColKey, string>,
        },
      });
      downloadBlob(blob, `employee-register-${now.toISOString().slice(0, 10)}.pdf`);
      toast({ type: 'success', title: t('register.done') });
      setPrintOpen(false);
    } catch {
      toast({ type: 'error', title: t('register.fail') });
    } finally {
      setPrinting(false);
    }
  };

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const [st, pos, dep, co] = await Promise.all([
        supabase.from('stores').select('id, store_name').eq('active', true).order('store_name'),
        supabase.from('hr_positions').select('id, name').eq('active', true).order('sort_order'),
        supabase.from('hr_departments').select('id, name').eq('active', true).order('name'),
        supabase.from('hr_companies').select('id, name').order('name'),
      ]);
      setStores((st.data ?? []).map((s) => ({ id: s.id as string, name: s.store_name as string })));
      setCompanies((co.data ?? []).map((c) => ({ id: c.id as string, name: c.name as string })));
      setPositions((pos.data ?? []).map((p) => ({ id: p.id as string, name: p.name as string })));
      setDepartments((dep.data ?? []).map((d) => ({ id: d.id as string, name: d.name as string })));
    })();
  }, []);

  const fetchEmployees = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (companyId) params.set('company_id', companyId);
    if (storeId) params.set('store_id', storeId);
    if (positionId) params.set('position_id', positionId);
    if (departmentId) params.set('department_id', departmentId);
    if (payType) params.set('pay_type', payType);
    if (status) params.set('status', status);
    const res = await fetch(`/api/hr/employees?${params.toString()}`);
    if (res.ok) {
      const json = await res.json();
      setRows(json.data ?? []);
      setCount(json.count ?? 0);
    }
    setLoading(false);
  }, [q, companyId, storeId, positionId, departmentId, payType, status]);

  useEffect(() => {
    const id = setTimeout(fetchEmployees, 250); // debounce search
    return () => clearTimeout(id);
  }, [fetchEmployees]);

  const clearFilters = () => {
    setQ('');
    setStoreId('');
    setPositionId('');
    setDepartmentId('');
    setPayType('');
    setStatus('');
  };

  const columns = useMemo<Column<EmployeeRow>[]>(
    () => [
      {
        key: 'name',
        header: t('col.name'),
        sortable: true,
        sortValue: (e) => employeeName(e),
        render: (e) => (
          <div className="min-w-0">
            <div className="truncate font-medium text-gray-900 dark:text-white">
              {employeeName(e)}
            </div>
            <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-gray-400">
              {e.employee_code && <span>{e.employee_code}</span>}
              {/* login username — read-only context, same as the accounts tab shows */}
              {e.profile?.username && <span>@{e.profile.username}</span>}
            </div>
          </div>
        ),
      },
      { key: 'position', header: t('col.position'), sortable: true, sortValue: (e) => e.position?.name ?? null, render: (e) => e.position?.name || '—' },
      { key: 'department', header: t('col.department'), sortable: true, sortValue: (e) => e.department?.name ?? null, render: (e) => e.department?.name || '—' },
      { key: 'company', header: t('col.company'), sortable: true, sortValue: (e) => e.company?.name ?? null, render: (e) => e.company?.name || '—' },
      {
        key: 'venue',
        header: t('col.venue'),
        sortable: true,
        sortValue: (e) => (e.stores.length ? e.stores.map((s) => s.store_name).join(', ') : null),
        render: (e) => (e.stores.length ? e.stores.map((s) => s.store_name).join(', ') : '—'),
      },
      {
        key: 'payType',
        header: t('col.payType'),
        sortable: true,
        sortValue: (e) => e.pay_type,
        render: (e) => (
          <Badge variant={e.pay_type === 'full_monthly' ? 'info' : 'outline'} size="sm">
            {t(`payType.${e.pay_type}`)}
          </Badge>
        ),
      },
      {
        key: 'rate',
        header: t('col.rate'),
        className: 'text-right',
        sortable: true,
        sortValue: (e) => e.rate_satang,
        render: (e) => <span className="tabular-nums">{bahtFromSatang(e.rate_satang)}</span>,
      },
      {
        key: 'status',
        header: t('col.status'),
        sortable: true,
        sortValue: (e) => e.status,
        render: (e) => (
          <StatusBadge tone={STATUS_TONE[e.status] ?? 'neutral'} label={t(`status.${e.status}`)} />
        ),
      },
      {
        // Compact data-completeness icons: bank account on file + daily hours (งาน+พัก).
        key: 'info',
        header: t('col.info'),
        sortable: true,
        // Sort: missing bank first when ascending (so HR spots gaps), then by hours.
        sortValue: (e) => `${e.bank_account_no ? 1 : 0}-${e.work_hours_per_day ?? 0}`,
        render: (e) => {
          const hasBank = !!e.bank_account_no;
          return (
            <div className="flex items-center gap-2">
              <span
                title={hasBank ? `${t('col.hasBank')}${e.bank_name ? ` (${e.bank_name})` : ''}` : t('col.noBank')}
                className={hasBank ? 'text-emerald-500' : 'text-gray-300 dark:text-gray-600'}
              >
                <Banknote className="h-4 w-4" />
              </span>
              <span
                className="inline-flex items-center gap-1 text-xs tabular-nums text-gray-600 dark:text-gray-300"
                title={t('col.hoursHint')}
              >
                <Clock className="h-3.5 w-3.5 text-gray-400" />
                {e.work_hours_per_day != null
                  ? `${e.work_hours_per_day}+${e.break_hours ?? 0}`
                  : '—'}
              </span>
            </div>
          );
        },
      },
      {
        // สิทธิ์ระบบ (login role) — deliberately distinct from the ตำแหน่ง (job position) column
        // so HR sees at a glance when the two drifted apart (e.g. หัวหน้าบาร์ still on Staff access).
        key: 'systemRole',
        header: t('col.systemRole'),
        sortable: true,
        sortValue: (e) => (e.profile?.role as string) ?? null,
        render: (e) => {
          const role = e.profile?.role as UserRole | undefined;
          return (
            <div className="flex flex-wrap items-center gap-1">
              {/* เหลือง = ยังไม่ได้กำหนดสิทธิ์ (not_assign) ให้ HR เห็นแล้วรีบจัดการ */}
              <Badge variant={role === 'not_assign' ? 'warning' : 'outline'} size="sm">
                <span className="inline-flex items-center gap-1">
                  <Shield className="h-3 w-3" />
                  {role ? ROLE_LABELS[role] || role : '—'}
                </span>
              </Badge>
              {e.profile?.active === false && (
                <Badge variant="danger" size="sm">{t('col.accountDisabled')}</Badge>
              )}
            </div>
          );
        },
      },
      {
        key: 'actions',
        header: '',
        className: 'w-40 text-right',
        render: (e) => (
          <div className="flex items-center justify-end gap-0.5">
            <button
              type="button"
              title={t('detail.action')}
              aria-label={t('detail.action')}
              onClick={(ev) => { ev.stopPropagation(); setDetailFor(e); }}
              className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-indigo-600 dark:hover:bg-gray-700 dark:hover:text-indigo-400"
            >
              <UserRound className="h-4 w-4" />
            </button>
            <button
              type="button"
              title={t('profile.action')}
              aria-label={t('profile.action')}
              disabled={profilePrintId === e.id}
              onClick={(ev) => { ev.stopPropagation(); printProfile(e); }}
              className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-emerald-600 disabled:opacity-50 dark:hover:bg-gray-700 dark:hover:text-emerald-400"
            >
              <IdCard className="h-4 w-4" />
            </button>
            <button
              type="button"
              title={t('history.action')}
              aria-label={t('history.action')}
              onClick={(ev) => {
                ev.stopPropagation();
                setHistoryFor({ id: e.id, name: employeeName(e) });
              }}
              className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-indigo-600 dark:hover:bg-gray-700 dark:hover:text-indigo-400"
            >
              <History className="h-4 w-4" />
            </button>
            <button
              type="button"
              title={t('payHistory.action')}
              aria-label={t('payHistory.action')}
              onClick={(ev) => {
                ev.stopPropagation();
                setPayHistoryFor({ id: e.id, name: employeeName(e) });
              }}
              className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-amber-600 dark:hover:bg-gray-700 dark:hover:text-amber-400"
            >
              <Archive className="h-4 w-4" />
            </button>
            <button
              type="button"
              title={t('transfer.action')}
              aria-label={t('transfer.action')}
              onClick={(ev) => {
                ev.stopPropagation();
                setTransfer({
                  id: e.id,
                  companyId: (e.company_id as string) ?? null,
                  companyName: e.company?.name ?? null,
                });
              }}
              className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-teal-600 dark:hover:bg-gray-700 dark:hover:text-teal-400"
            >
              <ArrowLeftRight className="h-4 w-4" />
            </button>
          </div>
        ),
      },
    ],
    [t]
  );

  const opt = (items: Ref[]) => items.map((i) => ({ value: i.id, label: i.name }));

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <PageHeader
        title={t('title')}
        subtitle={
          tab === 'employees' ? `${t('subtitle')} · ${t('count', { count })}`
          : tab === 'accounts' ? t('tabAccountsSubtitle')
          : t('tabLinksSubtitle')
        }
        actions={
          tab === 'employees' ? (
            <>
              <Button variant="outline" type="button" onClick={openPrintModal}>
                <Printer className="h-4 w-4" />
                {t('register.action')}
              </Button>
              <Button
                onClick={() => {
                  setEditId(null);
                  setFormOpen(true);
                }}
              >
                <Plus className="h-4 w-4" />
                {t('add')}
              </Button>
            </>
          ) : undefined
        }
      />

      {/* พนักงาน (HR registry) | บัญชีผู้ใช้ & สิทธิ์ระบบ (formerly /users) | ลิงก์รับพนักงาน */}
      <div className="flex w-fit flex-wrap gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
        {(
          [
            { key: 'employees', icon: Users, label: t('tabEmployees') },
            { key: 'accounts', icon: UserCog, label: t('tabAccounts') },
            { key: 'links', icon: Link2, label: t('tabLinks') },
          ] as const
        ).map(({ key, icon: Icon, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => switchTab(key)}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              tab === key
                ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'accounts' && (
        <UsersManager
          key={accountsSeed || (accountsClaims ? 'claims' : 'accounts')}
          initialSearch={accountsSeed}
          initialShowClaims={accountsClaims}
        />
      )}

      {tab === 'links' && <InviteLinksManager />}

      {tab === 'employees' && (
      <>
      {/* filters */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('searchPlaceholder')}
          className="control col-span-2 lg:col-span-2"
        />
        <Select value={companyId} onChange={(e) => setCompanyId(e.target.value)} placeholder={t('filter.company')} options={[{ value: '', label: t('filter.all') }, ...opt(companies)]} />
        <Select value={storeId} onChange={(e) => setStoreId(e.target.value)} placeholder={t('filter.venue')} options={[{ value: '', label: t('filter.all') }, ...opt(stores)]} />
        <Select value={positionId} onChange={(e) => setPositionId(e.target.value)} placeholder={t('filter.position')} options={[{ value: '', label: t('filter.all') }, ...opt(positions)]} />
        <Select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} placeholder={t('filter.department')} options={[{ value: '', label: t('filter.all') }, ...opt(departments)]} />
        <Select value={payType} onChange={(e) => setPayType(e.target.value)} placeholder={t('filter.payType')} options={[{ value: '', label: t('filter.all') }, ...PAY_TYPES.map((p) => ({ value: p, label: t(`payType.${p}`) }))]} />
        {/* สถานะ sits beside ประเภทการจ่าย in the same grid row on wide screens (owner ask 2026-07-27) */}
        <Select value={status} onChange={(e) => setStatus(e.target.value)} placeholder={t('filter.status')} options={[{ value: '', label: t('filter.all') }, ...STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) }))]} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={clearFilters}>
          {t('filter.clear')}
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        keyExtractor={(e) => e.id}
        emptyMessage={t('empty')}
        isLoading={loading}
        onRowClick={(e) => {
          setEditId(e.id);
          setFormOpen(true);
        }}
      />
      </>
      )}

      {/* Print-register modal: pick the company scope + which columns to print */}
      <Modal
        isOpen={printOpen}
        onClose={() => !printing && setPrintOpen(false)}
        title={t('register.modalTitle')}
        size="md"
      >
        <div className="space-y-4">
          <Select
            label={t('register.companyLabel')}
            value={printCompany}
            onChange={(e) => setPrintCompany(e.target.value)}
            options={[{ value: '', label: t('register.allCompanies') }, ...opt(companies)]}
          />
          <div>
            <p className="mb-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('register.fieldsLabel')}
            </p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              {REGISTER_COLS.map((c) => (
                <label key={c.key} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={printCols[c.key]}
                    onChange={(e) => setPrintCols((prev) => ({ ...prev, [c.key]: e.target.checked }))}
                    className="h-4 w-4 rounded border-gray-300 text-teal-600"
                  />
                  {registerColLabel(c.key)}
                </label>
              ))}
            </div>
          </div>
        </div>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setPrintOpen(false)} disabled={printing}>
            {t('register.cancel')}
          </Button>
          <Button
            onClick={printRegister}
            isLoading={printing}
            disabled={printing || !Object.values(printCols).some(Boolean)}
            icon={<Printer className="h-4 w-4" />}
          >
            {t('register.print')}
          </Button>
        </ModalFooter>
      </Modal>

      <EmployeeFormModal
        isOpen={formOpen}
        employeeId={editId}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setFormOpen(false);
          fetchEmployees();
        }}
      />

      <TransferModal
        isOpen={transfer !== null}
        employeeId={transfer?.id ?? null}
        currentCompanyId={transfer?.companyId ?? null}
        currentCompanyName={transfer?.companyName ?? null}
        onClose={() => setTransfer(null)}
        onDone={() => {
          setTransfer(null);
          fetchEmployees();
        }}
      />

      <EmployeePayHistoryModal
        employeeId={payHistoryFor?.id ?? null}
        employeeName={payHistoryFor?.name ?? ''}
        onClose={() => setPayHistoryFor(null)}
      />

      <EmployeeHistoryModal
        employeeId={historyFor?.id ?? null}
        employeeName={historyFor?.name ?? ''}
        onClose={() => setHistoryFor(null)}
      />

      <EmployeeDetailModal
        employee={detailFor}
        onClose={() => setDetailFor(null)}
        onManageAccount={(username) => {
          setDetailFor(null);
          switchTab('accounts', username);
        }}
      />

    </div>
  );
}
