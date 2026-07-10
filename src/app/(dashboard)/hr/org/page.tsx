'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Plus, Pencil, Building2, Briefcase, Network, Users, ChevronDown, Search, Settings2, Loader2 } from 'lucide-react';
import { Button, Tabs, PageHeader, StatusBadge, type StatusTone, toast } from '@/components/ui';
import { cn } from '@/lib/utils/cn';

interface OrgRow {
  id: string;
  name: string;
  sort_order?: number;
  active: boolean;
}

interface OrgListProps {
  endpoint: string;
  withSort: boolean;
  addLabel: string;
}

function OrgList({ endpoint, withSort, addLabel }: OrgListProps) {
  const t = useTranslations('hr.org');

  const [rows, setRows] = useState<OrgRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // add form
  const [newName, setNewName] = useState('');
  const [newSort, setNewSort] = useState('');

  // inline edit
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editSort, setEditSort] = useState('');

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(endpoint);
      if (res.ok) {
        const json = await res.json();
        setRows((json.data ?? []) as OrgRow[]);
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
  }, [endpoint, t]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const failToast = (message?: string) => {
    toast({ type: 'error', title: t('saveFailed'), message });
  };

  const addItem = async () => {
    const name = newName.trim();
    if (!name) {
      toast({ type: 'error', title: t('requiredName') });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(withSort ? { name, sort_order: Number(newSort) || 0 } : { name }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        failToast(json.error);
        return;
      }
      toast({ type: 'success', title: t('createdOk') });
      setNewName('');
      setNewSort('');
      await fetchRows();
    } catch (err) {
      failToast(err instanceof Error ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (row: OrgRow) => {
    setEditId(row.id);
    setEditName(row.name);
    setEditSort(row.sort_order != null ? String(row.sort_order) : '');
  };

  const cancelEdit = () => {
    setEditId(null);
    setEditName('');
    setEditSort('');
  };

  const saveEdit = async (row: OrgRow) => {
    const name = editName.trim();
    if (!name) {
      toast({ type: 'error', title: t('requiredName') });
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { name };
      if (withSort) payload.sort_order = Number(editSort) || 0;
      const res = await fetch(`${endpoint}/${row.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        failToast(json.error);
        return;
      }
      toast({ type: 'success', title: t('savedOk') });
      cancelEdit();
      await fetchRows();
    } catch (err) {
      failToast(err instanceof Error ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (row: OrgRow) => {
    setSaving(true);
    try {
      const res = await fetch(`${endpoint}/${row.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !row.active }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        failToast(json.error);
        return;
      }
      toast({ type: 'success', title: t('savedOk') });
      await fetchRows();
    } catch (err) {
      failToast(err instanceof Error ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* add row */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/40">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') addItem();
          }}
          placeholder={t('namePlaceholder')}
          aria-label={t('name')}
          className={cn('control', 'min-w-0 flex-1')}
        />
        {withSort && (
          <input
            type="number"
            value={newSort}
            onChange={(e) => setNewSort(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addItem();
            }}
            placeholder={t('sortOrder')}
            aria-label={t('sortOrder')}
            className={cn('control', 'w-20 shrink-0 tabular-nums')}
          />
        )}
        <Button size="sm" onClick={addItem} isLoading={saving} className="shrink-0">
          <Plus className="h-4 w-4" />
          {addLabel}
        </Button>
      </div>

      {/* list */}
      {loading ? (
        <div className="py-10 text-center text-sm text-gray-400">…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 py-10 text-center text-sm text-gray-400 dark:border-gray-700 dark:text-gray-500">
          {t('empty')}
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 dark:divide-gray-800 dark:border-gray-700">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center gap-2 bg-white px-3 py-2.5 dark:bg-gray-900"
            >
              {editId === row.id ? (
                <>
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveEdit(row);
                      if (e.key === 'Escape') cancelEdit();
                    }}
                    aria-label={t('name')}
                    className={cn('control', 'min-w-0 flex-1')}
                    autoFocus
                  />
                  {withSort && (
                    <input
                      type="number"
                      value={editSort}
                      onChange={(e) => setEditSort(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveEdit(row);
                        if (e.key === 'Escape') cancelEdit();
                      }}
                      aria-label={t('sortOrder')}
                      className={cn('control', 'w-20 shrink-0 tabular-nums')}
                    />
                  )}
                  <Button size="sm" onClick={() => saveEdit(row)} isLoading={saving}>
                    {t('save')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={cancelEdit} disabled={saving}>
                    {t('cancel')}
                  </Button>
                </>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate font-medium text-gray-900 dark:text-white">
                    {row.name}
                  </span>
                  {withSort && (
                    <span className="w-8 shrink-0 text-right text-xs tabular-nums text-gray-400">
                      {row.sort_order ?? 0}
                    </span>
                  )}
                  <StatusBadge
                    tone={row.active ? 'good' : 'neutral'}
                    label={row.active ? t('active') : t('inactive')}
                  />
                  <button
                    type="button"
                    onClick={() => startEdit(row)}
                    disabled={saving}
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
                    disabled={saving}
                    className="shrink-0"
                  >
                    {row.active ? t('deactivate') : t('activate')}
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Grouped employee directory (owner ask 2026-07-10) ────────────────────────

type OrgEmployee = {
  id: string;
  full_name: string | null;
  employee_code: string | null;
  pay_type: string;
  status: string;
  profile: { display_name?: string | null; username?: string | null } | null;
  position: { name?: string | null } | null;
  department: { name?: string | null } | null;
  company: { name?: string | null } | null;
  stores: { id: string; store_name: string }[];
};

type GroupBy = 'company' | 'position' | 'department';
const STATUS_TONE: Record<string, StatusTone> = { active: 'good', probation: 'warn', resigned: 'neutral', terminated: 'critical' };

export default function OrgPage() {
  const t = useTranslations('hr.org');
  const isTh = useLocale() === 'th';
  const L = isTh
    ? { directory: 'ทำเนียบพนักงาน', byCompany: 'ตามบริษัท', byPosition: 'ตามตำแหน่ง', byDepartment: 'ตามแผนก', search: 'ค้นหาชื่อพนักงาน', unassigned: 'ยังไม่ระบุ', people: 'คน', manage: 'จัดการตำแหน่ง/แผนก', noEmp: 'ไม่พบพนักงาน', groupBy: 'จัดกลุ่ม', status: { active: 'ทำงาน', probation: 'ทดลองงาน', resigned: 'ลาออก', terminated: 'เลิกจ้าง' } }
    : { directory: 'Staff directory', byCompany: 'By company', byPosition: 'By position', byDepartment: 'By department', search: 'Search employee', unassigned: 'Unassigned', people: '', manage: 'Manage positions / departments', noEmp: 'No employees', groupBy: 'Group by', status: { active: 'Active', probation: 'Probation', resigned: 'Resigned', terminated: 'Terminated' } };

  const [emps, setEmps] = useState<OrgEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [groupBy, setGroupBy] = useState<GroupBy>('company');
  const [q, setQ] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [manageOpen, setManageOpen] = useState(false);
  const [mTab, setMTab] = useState<'positions' | 'departments'>('positions');

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/hr/employees?limit=200');
        const j = await res.json().catch(() => ({}));
        setEmps((j.data ?? []) as OrgEmployee[]);
      } catch {
        setEmps([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const empName = (e: OrgEmployee) => e.full_name?.trim() || e.profile?.display_name || e.profile?.username || '—';
  const groupKeyOf = (e: OrgEmployee) => {
    const v = groupBy === 'company' ? e.company?.name : groupBy === 'position' ? e.position?.name : e.department?.name;
    return (v ?? '').trim() || L.unassigned;
  };

  const groups = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const filtered = ql ? emps.filter((e) => empName(e).toLowerCase().includes(ql) || (e.employee_code ?? '').toLowerCase().includes(ql)) : emps;
    const m = new Map<string, OrgEmployee[]>();
    for (const e of filtered) {
      const k = groupKeyOf(e);
      const list = m.get(k) ?? [];
      list.push(e);
      m.set(k, list);
    }
    for (const list of m.values()) list.sort((a, b) => empName(a).localeCompare(empName(b), 'th'));
    // Real groups first (by size), the "unassigned" bucket last.
    return [...m.entries()].sort((a, b) => {
      if (a[0] === L.unassigned) return 1;
      if (b[0] === L.unassigned) return -1;
      return b[1].length - a[1].length || a[0].localeCompare(b[0], 'th');
    });
  }, [emps, q, groupBy]); // eslint-disable-line react-hooks/exhaustive-deps

  const GROUP_OPTS: { key: GroupBy; label: string; icon: typeof Building2 }[] = [
    { key: 'company', label: L.byCompany, icon: Building2 },
    { key: 'position', label: L.byPosition, icon: Briefcase },
    { key: 'department', label: L.byDepartment, icon: Network },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      {/* Toolbar: group-by + search + total */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-0.5 rounded-lg bg-gray-100 p-0.5 dark:bg-gray-800">
          {GROUP_OPTS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setGroupBy(key)}
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors',
                groupBy === key ? 'bg-white text-indigo-600 shadow-sm dark:bg-gray-700 dark:text-indigo-300' : 'text-gray-500 dark:text-gray-400'
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
        <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={L.search} className="control control-icon w-full" />
        </div>
      </div>

      {/* Directory */}
      {loading ? (
        <div className="flex justify-center py-12 text-gray-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : groups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 py-12 text-center text-sm text-gray-400 dark:border-gray-700">{L.noEmp}</div>
      ) : (
        <div className="space-y-2">
          {groups.map(([name, list]) => {
            const isCollapsed = collapsed.has(name);
            return (
              <div key={name} className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
                <button
                  type="button"
                  onClick={() => setCollapsed((prev) => { const n = new Set(prev); if (n.has(name)) n.delete(name); else n.add(name); return n; })}
                  className="flex w-full items-center justify-between gap-2 bg-gray-50 px-4 py-2.5 text-left hover:bg-gray-100 dark:bg-gray-800/60 dark:hover:bg-gray-800"
                >
                  <span className="flex items-center gap-2 font-semibold text-gray-800 dark:text-gray-100">
                    <ChevronDown className={cn('h-4 w-4 shrink-0 text-gray-400 transition-transform', isCollapsed && '-rotate-90')} />
                    {name}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
                    <Users className="h-3 w-3" /> {list.length}
                  </span>
                </button>
                {!isCollapsed && (
                  <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                    {list.map((e) => (
                      <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-white px-4 py-2.5 dark:bg-gray-900">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-gray-900 dark:text-white">
                            {empName(e)}
                            {e.profile?.display_name && e.profile.display_name !== empName(e) && (
                              <span className="ml-1.5 text-xs font-normal text-gray-400">({e.profile.display_name})</span>
                            )}
                          </p>
                          <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                            {[
                              groupBy !== 'position' ? e.position?.name : null,
                              groupBy !== 'department' ? e.department?.name : null,
                              groupBy !== 'company' ? e.company?.name : null,
                              e.stores.length ? e.stores.map((s) => s.store_name).join(', ') : null,
                            ].filter(Boolean).join(' · ') || '—'}
                          </p>
                        </div>
                        {e.employee_code && <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] text-gray-500 dark:bg-gray-700 dark:text-gray-400">{e.employee_code}</span>}
                        <StatusBadge tone={STATUS_TONE[e.status] ?? 'neutral'} label={L.status[e.status as keyof typeof L.status] ?? e.status} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Structure management (positions / departments) — collapsed by default */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700">
        <button
          type="button"
          onClick={() => setManageOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
        >
          <span className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
            <Settings2 className="h-4 w-4 text-gray-400" /> {L.manage}
          </span>
          <ChevronDown className={cn('h-4 w-4 text-gray-400 transition-transform', !manageOpen && '-rotate-90')} />
        </button>
        {manageOpen && (
          <div className="border-t border-gray-100 p-4 dark:border-gray-800">
            <Tabs
              tabs={[
                { id: 'positions', label: t('tabPositions') },
                { id: 'departments', label: t('tabDepartments') },
              ]}
              activeTab={mTab}
              onChange={(id) => setMTab(id as 'positions' | 'departments')}
            />
            <div className="mt-3">
              {mTab === 'positions' ? (
                <OrgList endpoint="/api/hr/positions" withSort addLabel={t('addPosition')} />
              ) : (
                <OrgList endpoint="/api/hr/departments" withSort={false} addLabel={t('addDepartment')} />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
