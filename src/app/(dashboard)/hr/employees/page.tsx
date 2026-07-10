'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, ArrowLeftRight, History, Printer, IdCard, Archive, UserRound, Link2 } from 'lucide-react';
import { Button, Select, Badge, PageHeader, StatusBadge, type StatusTone, toast } from '@/components/ui';
import { DataTable, type Column } from '@/components/data/data-table';
import { createClient } from '@/lib/supabase/client';
import { EmployeeFormModal } from './_components/employee-form-modal';
import { TransferModal } from './_components/transfer-modal';
import { EmployeeHistoryModal } from './_components/employee-history-modal';
import { EmployeePayHistoryModal } from './_components/employee-pay-history-modal';
import { EmployeeDetailModal } from './_components/employee-detail-modal';
import { RegistrationLinkModal } from './_components/registration-link-modal';

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
  profile: { display_name?: string | null; username?: string | null } | null;
  position: { name?: string | null } | null;
  department: { name?: string | null } | null;
  company: { name?: string | null } | null;
  stores: { id: string; store_name: string }[];
}

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

export default function EmployeesPage() {
  const t = useTranslations('hr.employees');

  const [rows, setRows] = useState<EmployeeRow[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);

  // filters
  const [q, setQ] = useState('');
  const [storeId, setStoreId] = useState('');
  const [positionId, setPositionId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [payType, setPayType] = useState('');
  const [status, setStatus] = useState('');

  // filter option data
  const [stores, setStores] = useState<Ref[]>([]);
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
  const [profilePrintId, setProfilePrintId] = useState<string | null>(null);
  const [showRegLink, setShowRegLink] = useState(false);

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

  const printRegister = async () => {
    if (rows.length === 0) return;
    setPrinting(true);
    try {
      const { buildEmployeeRegisterPdf, downloadBlob } = await import('./_components/employee-register-pdf');
      const companies = [...new Set(rows.map((r) => r.company?.name).filter(Boolean))];
      const companyName = companies.length === 1 ? (companies[0] as string) : t('register.allCompanies');
      const now = new Date();
      const generated = new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(now);
      const blob = await buildEmployeeRegisterPdf({
        company_name: companyName,
        generated_label: generated,
        headcount: rows.length,
        rows: rows.map((r) => ({
          code: r.employee_code || '',
          name: employeeName(r),
          position: r.position?.name || '—',
          department: r.department?.name || '—',
          store: r.stores.length ? r.stores.map((s) => s.store_name).join(', ') : '—',
          pay_type: t(`payType.${r.pay_type}`),
          rate: bahtFromSatang(r.rate_satang),
          status: t(`status.${r.status}`),
        })),
        labels: {
          title: t('register.title'), no: t('register.no'), code: t('register.code'), name: t('register.name'),
          position: t('register.position'), department: t('register.department'), store: t('register.store'),
          pay: t('register.pay'), rate: t('register.rate'), status: t('register.status'),
          headcount: t('register.headcount'), page: t('register.page'),
        },
      });
      downloadBlob(blob, `employee-register-${now.toISOString().slice(0, 10)}.pdf`);
      toast({ type: 'success', title: t('register.done') });
    } catch {
      toast({ type: 'error', title: t('register.fail') });
    } finally {
      setPrinting(false);
    }
  };

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const [st, pos, dep] = await Promise.all([
        supabase.from('stores').select('id, store_name').eq('active', true).order('store_name'),
        supabase.from('hr_positions').select('id, name').eq('active', true).order('sort_order'),
        supabase.from('hr_departments').select('id, name').eq('active', true).order('name'),
      ]);
      setStores((st.data ?? []).map((s) => ({ id: s.id as string, name: s.store_name as string })));
      setPositions((pos.data ?? []).map((p) => ({ id: p.id as string, name: p.name as string })));
      setDepartments((dep.data ?? []).map((d) => ({ id: d.id as string, name: d.name as string })));
    })();
  }, []);

  const fetchEmployees = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
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
  }, [q, storeId, positionId, departmentId, payType, status]);

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
        render: (e) => (
          <div className="min-w-0">
            <div className="truncate font-medium text-gray-900 dark:text-white">
              {employeeName(e)}
            </div>
            {e.employee_code && (
              <div className="text-xs text-gray-400">{e.employee_code}</div>
            )}
          </div>
        ),
      },
      { key: 'position', header: t('col.position'), render: (e) => e.position?.name || '—' },
      { key: 'department', header: t('col.department'), render: (e) => e.department?.name || '—' },
      { key: 'company', header: t('col.company'), render: (e) => e.company?.name || '—' },
      {
        key: 'venue',
        header: t('col.venue'),
        render: (e) => (e.stores.length ? e.stores.map((s) => s.store_name).join(', ') : '—'),
      },
      {
        key: 'payType',
        header: t('col.payType'),
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
        render: (e) => <span className="tabular-nums">{bahtFromSatang(e.rate_satang)}</span>,
      },
      {
        key: 'status',
        header: t('col.status'),
        render: (e) => (
          <StatusBadge tone={STATUS_TONE[e.status] ?? 'neutral'} label={t(`status.${e.status}`)} />
        ),
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
        subtitle={`${t('subtitle')} · ${t('count', { count })}`}
        actions={
          <>
            <Button variant="outline" type="button" onClick={() => setShowRegLink(true)}>
              <Link2 className="h-4 w-4" />
              {t('regLink')}
            </Button>
            <Button
              variant="outline"
              type="button"
              onClick={printRegister}
              isLoading={printing}
              disabled={rows.length === 0 || printing}
            >
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
        }
      />

      {/* filters */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('searchPlaceholder')}
          className="control col-span-2 lg:col-span-2"
        />
        <Select value={storeId} onChange={(e) => setStoreId(e.target.value)} placeholder={t('filter.venue')} options={[{ value: '', label: t('filter.all') }, ...opt(stores)]} />
        <Select value={positionId} onChange={(e) => setPositionId(e.target.value)} placeholder={t('filter.position')} options={[{ value: '', label: t('filter.all') }, ...opt(positions)]} />
        <Select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} placeholder={t('filter.department')} options={[{ value: '', label: t('filter.all') }, ...opt(departments)]} />
        <Select value={payType} onChange={(e) => setPayType(e.target.value)} placeholder={t('filter.payType')} options={[{ value: '', label: t('filter.all') }, ...PAY_TYPES.map((p) => ({ value: p, label: t(`payType.${p}`) }))]} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} placeholder={t('filter.status')} className="max-w-[180px]" options={[{ value: '', label: t('filter.all') }, ...STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) }))]} />
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

      <EmployeeDetailModal employee={detailFor} onClose={() => setDetailFor(null)} />

      <RegistrationLinkModal isOpen={showRegLink} onClose={() => setShowRegLink(false)} />
    </div>
  );
}
