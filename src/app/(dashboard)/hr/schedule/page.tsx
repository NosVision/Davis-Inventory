'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Plus, X } from 'lucide-react';
import { Button, Badge, toast } from '@/components/ui';
import { todayBangkok } from '@/lib/utils/date';

interface StoreOpt {
  id: string;
  store_code: string;
  store_name: string;
}
interface Employee {
  user_id: string;
  name: string;
  work_hours_per_day: number;
  standard_days_off: number;
}
interface Template {
  id: string;
  label: string;
  start_time: string;
  end_time: string;
  color: string | null;
}
interface Entry {
  id: string;
  user_id: string;
  work_date: string;
  shift_template_id: string | null;
  is_day_off: boolean;
  status: string;
  note: string | null;
}
interface Balance {
  user_id: string;
  work_days: number;
  day_off_days: number;
  scheduled_minutes: number;
  standard_minutes: number;
  off_target: number;
  off_delta: number;
}
type MonthStatus = 'empty' | 'draft' | 'submitted' | 'acknowledged' | 'mixed';

const hhmm = (t: string) => t.slice(0, 5);
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function daysOfMonth(month: string): string[] {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}
function weekday(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return WEEKDAYS[new Date(y, m - 1, d).getDay()];
}

export default function SchedulePage() {
  const t = useTranslations('hr.schedule');

  const [stores, setStores] = useState<StoreOpt[]>([]);
  const [storeId, setStoreId] = useState('');
  const [month, setMonth] = useState<string>(() => todayBangkok().slice(0, 7));

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [balance, setBalance] = useState<Balance[]>([]);
  const [monthStatus, setMonthStatus] = useState<MonthStatus>('empty');
  const [loading, setLoading] = useState(true);

  const [selected, setSelected] = useState<{ userId: string; date: string } | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ label: '', start: '17:00', end: '01:00', color: '#6366f1' });

  // manageable stores
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/hr/manageable-stores');
        const json = await res.json();
        const list = (json.data ?? []) as StoreOpt[];
        setStores(list);
        setStoreId((prev) => prev || list[0]?.id || '');
      } catch {
        setStores([]);
      }
    })();
  }, []);

  const load = useCallback(async () => {
    if (!storeId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/hr/schedule?store_id=${storeId}&month=${month}`);
      if (!res.ok) throw new Error('load failed');
      const j = await res.json();
      setEmployees((j.employees ?? []) as Employee[]);
      setTemplates((j.templates ?? []) as Template[]);
      setEntries((j.entries ?? []) as Entry[]);
      setBalance((j.balance ?? []) as Balance[]);
      setMonthStatus((j.monthStatus ?? 'empty') as MonthStatus);
    } catch {
      toast({ type: 'error', title: t('actionFailed') });
    } finally {
      setLoading(false);
      setSelected(null);
    }
  }, [storeId, month, t]);

  useEffect(() => {
    load();
  }, [load]);

  const days = useMemo(() => daysOfMonth(month), [month]);
  const tplById = useMemo(() => new Map(templates.map((x) => [x.id, x])), [templates]);
  const balByUser = useMemo(() => new Map(balance.map((b) => [b.user_id, b])), [balance]);
  const entryByCell = useMemo(() => {
    const m = new Map<string, Entry>();
    for (const e of entries) m.set(`${e.user_id}|${e.work_date}`, e);
    return m;
  }, [entries]);

  // --- cell assignment ---
  const assign = useCallback(
    async (payload: { shift_template_id?: string; is_day_off?: boolean }) => {
      if (!selected) return;
      try {
        const res = await fetch('/api/hr/schedule', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ store_id: storeId, user_id: selected.userId, work_date: selected.date, ...payload }),
        });
        if (!res.ok) throw new Error();
        await load();
      } catch {
        toast({ type: 'error', title: t('saveFailed') });
      }
    },
    [selected, storeId, load, t]
  );

  const clearCell = useCallback(async () => {
    if (!selected) return;
    const e = entryByCell.get(`${selected.userId}|${selected.date}`);
    if (!e) return setSelected(null);
    try {
      const res = await fetch(`/api/hr/schedule?id=${e.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      await load();
    } catch {
      toast({ type: 'error', title: t('saveFailed') });
    }
  }, [selected, entryByCell, load, t]);

  // --- shift templates ---
  const addTemplate = useCallback(async () => {
    if (!form.label.trim()) return;
    try {
      const res = await fetch('/api/hr/shift-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ store_id: storeId, label: form.label.trim(), start_time: form.start, end_time: form.end, color: form.color }),
      });
      if (!res.ok) throw new Error();
      setForm({ label: '', start: '17:00', end: '01:00', color: '#6366f1' });
      setShowAdd(false);
      await load();
    } catch {
      toast({ type: 'error', title: t('saveFailed') });
    }
  }, [form, storeId, load, t]);

  const deactivateTemplate = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/hr/shift-templates?id=${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error();
        await load();
      } catch {
        toast({ type: 'error', title: t('saveFailed') });
      }
    },
    [load, t]
  );

  // --- publish actions ---
  const doAction = useCallback(
    async (path: 'submit' | 'acknowledge') => {
      try {
        const res = await fetch(`/api/hr/schedule/${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ store_id: storeId, month }),
        });
        if (!res.ok) throw new Error();
        toast({ type: 'success', title: path === 'submit' ? t('submittedToast') : t('acknowledgedToast') });
        await load();
      } catch {
        toast({ type: 'error', title: t('actionFailed') });
      }
    },
    [storeId, month, load, t]
  );

  const statusText: Record<MonthStatus, string> = {
    empty: t('statusEmpty'),
    draft: t('statusDraft'),
    submitted: t('statusSubmitted'),
    acknowledged: t('statusAcknowledged'),
    mixed: t('statusMixed'),
  };

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">{t('title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col text-xs font-medium text-gray-600 dark:text-gray-400">
            {t('filterStore')}
            <select
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
              className="mt-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            >
              {stores.length === 0 && <option value="">{t('noStores')}</option>}
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.store_name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col text-xs font-medium text-gray-600 dark:text-gray-400">
            {t('filterMonth')}
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="mt-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            />
          </label>
        </div>
      </div>

      {/* status + publish actions */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant={monthStatus === 'acknowledged' ? 'success' : monthStatus === 'submitted' ? 'info' : 'default'}
          size="sm"
        >
          {t('statusLabel')}: {statusText[monthStatus]}
        </Badge>
        <div className="flex-1" />
        <Button
          size="sm"
          variant="outline"
          onClick={() => doAction('submit')}
          disabled={monthStatus === 'empty' || monthStatus === 'acknowledged'}
        >
          {t('submitToHr')}
        </Button>
        <Button
          size="sm"
          onClick={() => doAction('acknowledge')}
          disabled={monthStatus !== 'submitted' && monthStatus !== 'mixed'}
        >
          {t('acknowledge')}
        </Button>
      </div>

      {/* shift templates strip */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{t('shifts')}:</span>
        {templates.length === 0 && (
          <span className="text-xs text-gray-400">{t('noTemplates')}</span>
        )}
        {templates.map((tpl) => (
          <span
            key={tpl.id}
            className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs dark:border-gray-700 dark:bg-gray-800"
          >
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: tpl.color || '#6366f1' }} />
            <span className="font-medium text-gray-800 dark:text-gray-200">{tpl.label}</span>
            <span className="tabular-nums text-gray-400">
              {hhmm(tpl.start_time)}–{hhmm(tpl.end_time)}
            </span>
            <button
              type="button"
              onClick={() => deactivateTemplate(tpl.id)}
              className="text-gray-300 hover:text-red-500"
              aria-label={t('deactivate')}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <button
          type="button"
          onClick={() => setShowAdd((v) => !v)}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-gray-300 px-2.5 py-1 text-xs text-gray-500 hover:border-indigo-400 hover:text-indigo-600 dark:border-gray-600"
        >
          <Plus className="h-3 w-3" /> {t('addShift')}
        </button>
      </div>

      {showAdd && (
        <div className="flex flex-wrap items-end gap-2 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/50">
          <input
            placeholder={t('shiftLabel')}
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
            className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          />
          <input
            type="time"
            value={form.start}
            onChange={(e) => setForm({ ...form, start: e.target.value })}
            className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          />
          <input
            type="time"
            value={form.end}
            onChange={(e) => setForm({ ...form, end: e.target.value })}
            className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          />
          <input
            type="color"
            value={form.color}
            onChange={(e) => setForm({ ...form, color: e.target.value })}
            className="h-9 w-10 rounded border border-gray-300 dark:border-gray-600"
          />
          <Button size="sm" onClick={addTemplate}>
            {t('add')}
          </Button>
        </div>
      )}

      {/* cell editor */}
      {selected && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 p-3 dark:border-indigo-800 dark:bg-indigo-900/20">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
            {t('editing')}: {employees.find((e) => e.user_id === selected.userId)?.name} · {selected.date}
          </span>
          <div className="flex-1" />
          {templates.map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              onClick={() => assign({ shift_template_id: tpl.id })}
              className="rounded-lg border px-2.5 py-1 text-xs font-medium text-white"
              style={{ backgroundColor: tpl.color || '#6366f1', borderColor: tpl.color || '#6366f1' }}
            >
              {tpl.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => assign({ is_day_off: true })}
            className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            {t('dayOff')}
          </button>
          <button
            type="button"
            onClick={clearCell}
            className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-gray-600"
          >
            {t('clear')}
          </button>
          <button
            type="button"
            onClick={() => setSelected(null)}
            className="rounded-lg px-2.5 py-1 text-xs text-gray-500 hover:text-gray-700"
          >
            {t('cancel')}
          </button>
        </div>
      )}

      {/* roster grid */}
      {loading ? (
        <div className="flex items-center justify-center py-10 text-gray-400">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : employees.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-400 dark:border-gray-700">
          {t('noEmployees')}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
          <table className="min-w-full border-collapse text-xs">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-800">
                <th className="sticky left-0 z-10 bg-gray-50 px-3 py-2 text-left font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                  {t('employee')}
                </th>
                {days.map((d) => (
                  <th
                    key={d}
                    className="min-w-[38px] px-1 py-2 text-center font-medium text-gray-500 dark:text-gray-400"
                  >
                    <div className="text-[10px] uppercase">{weekday(d)}</div>
                    <div className="tabular-nums">{Number(d.split('-')[2])}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {employees.map((emp) => (
                <tr key={emp.user_id} className="border-t border-gray-100 dark:border-gray-700/50">
                  <td className="sticky left-0 z-10 whitespace-nowrap bg-white px-3 py-1.5 font-medium text-gray-800 dark:bg-gray-900 dark:text-gray-200">
                    {emp.name}
                  </td>
                  {days.map((d) => {
                    const e = entryByCell.get(`${emp.user_id}|${d}`);
                    const tpl = e?.shift_template_id ? tplById.get(e.shift_template_id) : null;
                    const isSel = selected?.userId === emp.user_id && selected?.date === d;
                    return (
                      <td key={d} className="p-0.5 text-center">
                        <button
                          type="button"
                          onClick={() => setSelected({ userId: emp.user_id, date: d })}
                          className={`flex h-8 w-full items-center justify-center rounded ${
                            isSel ? 'ring-2 ring-indigo-500' : ''
                          } ${
                            e
                              ? e.is_day_off
                                ? 'bg-gray-100 text-gray-400 dark:bg-gray-700/50'
                                : 'text-white'
                              : 'bg-transparent hover:bg-gray-100 dark:hover:bg-gray-700/50'
                          }`}
                          style={!e || e.is_day_off ? undefined : { backgroundColor: tpl?.color || '#6366f1' }}
                          title={e?.is_day_off ? t('dayOff') : tpl?.label}
                        >
                          {e ? (
                            e.is_day_off ? (
                              <span className="text-[10px]">OFF</span>
                            ) : (
                              <span className="truncate px-0.5 text-[10px] font-medium">{tpl?.label?.slice(0, 3)}</span>
                            )
                          ) : (
                            ''
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* balance panel */}
      {!loading && employees.length > 0 && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700">
          <div className="border-b border-gray-100 px-3 py-2 text-sm font-semibold text-gray-700 dark:border-gray-700 dark:text-gray-300">
            {t('balanceHeading')}
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 dark:text-gray-400">
                  <th className="px-3 py-1.5">{t('employee')}</th>
                  <th className="px-3 py-1.5">{t('workDays')}</th>
                  <th className="px-3 py-1.5">
                    {t('offDays')} / {t('offTarget')}
                  </th>
                  <th className="px-3 py-1.5">
                    {t('hours')} / {t('standardHours')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {employees.map((emp) => {
                  const b = balByUser.get(emp.user_id);
                  const offBad = b ? b.off_delta !== 0 : false;
                  const hrs = b ? (b.scheduled_minutes / 60).toFixed(1) : '0.0';
                  const std = b ? (b.standard_minutes / 60).toFixed(1) : '0.0';
                  return (
                    <tr key={emp.user_id} className="border-t border-gray-100 dark:border-gray-700/50">
                      <td className="px-3 py-1.5 font-medium text-gray-800 dark:text-gray-200">{emp.name}</td>
                      <td className="px-3 py-1.5 tabular-nums text-gray-600 dark:text-gray-400">{b?.work_days ?? 0}</td>
                      <td className={`px-3 py-1.5 tabular-nums ${offBad ? 'font-semibold text-red-600 dark:text-red-400' : 'text-gray-600 dark:text-gray-400'}`}>
                        {b?.day_off_days ?? 0} / {b?.off_target ?? 0}
                      </td>
                      <td className="px-3 py-1.5 tabular-nums text-gray-600 dark:text-gray-400">
                        {hrs} / {std}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
