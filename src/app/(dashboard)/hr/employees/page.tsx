'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { Button, Select, Badge } from '@/components/ui';
import { DataTable, type Column } from '@/components/data/data-table';
import { createClient } from '@/lib/supabase/client';
import { EmployeeFormModal } from './_components/employee-form-modal';

interface Ref {
  id: string;
  name: string;
}
interface EmployeeRow extends Record<string, unknown> {
  id: string;
  profile_id: string;
  employee_code: string | null;
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

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'danger' | 'default'> = {
  active: 'success',
  probation: 'warning',
  resigned: 'default',
  terminated: 'danger',
};

function bahtFromSatang(satang: number): string {
  return (satang / 100).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
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
              {e.profile?.display_name || e.profile?.username || '—'}
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
          <Badge variant={STATUS_VARIANT[e.status] ?? 'default'} size="sm">
            {t(`status.${e.status}`)}
          </Badge>
        ),
      },
    ],
    [t]
  );

  const opt = (items: Ref[]) => items.map((i) => ({ value: i.id, label: i.name }));

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">{t('title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('subtitle')} · {t('count', { count })}
          </p>
        </div>
        <Button
          onClick={() => {
            setEditId(null);
            setFormOpen(true);
          }}
          className="shrink-0"
        >
          <Plus className="h-4 w-4" />
          {t('add')}
        </Button>
      </div>

      {/* filters */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('searchPlaceholder')}
          className="col-span-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-white lg:col-span-2"
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
    </div>
  );
}
