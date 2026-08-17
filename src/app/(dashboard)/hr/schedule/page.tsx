'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Loader2, Plus, Pencil, Save, Undo2, AlertTriangle } from 'lucide-react';
import { Button, Modal, ModalFooter, PageHeader, StatusBadge, type StatusTone, toast } from '@/components/ui';
import { PayrollScopeChips, spansMultipleCompanies, type PayrollScopeInfo } from '@/components/hr/payroll-scope-chips';
import { todayBangkok } from '@/lib/utils/date';
import ScheduleFillTools, { type PatternSlot } from './ScheduleFillTools';
import ShiftModal, { labelTimeMismatch, to12h } from './ShiftModal';

interface StoreOpt {
  id: string;
  store_code: string;
  store_name: string;
}
interface Employee extends PayrollScopeInfo {
  user_id: string;
  name: string;
  /** Real full name from the HR record — for the nickname ↔ full-name display toggle. */
  full_name?: string | null;
  username?: string | null;
  /** Job position — company scope sorts by it; null = ยังไม่กำหนดตำแหน่ง. */
  position_name?: string | null;
  work_hours_per_day: number;
  standard_days_off: number;
  /** Set only for departed staff — visible for their final month, capped by the API. */
  end_date?: string | null;
}
interface CompanyOpt {
  id: string;
  name: string;
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
type MonthStatus = 'empty' | 'draft' | 'submitted' | 'acknowledged' | 'mixed';

// The active "brush" painted onto cells and used by the bulk fill tools.
type Brush = { kind: 'shift'; id: string } | { kind: 'off' } | { kind: 'clear' } | null;
// A pending (unsaved) change for one cell: an assignment or a clear.
type DraftVal = { shift_template_id: string | null; is_day_off: boolean } | { clear: true };

const hhmm = (t: string) => t.slice(0, 5);
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function daysOfMonth(month: string): string[] {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}
function getDay(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}
function toMin(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
function shiftMinutes(start: string, end: string): number {
  const d = (toMin(end) - toMin(start) + 1440) % 1440;
  return d === 0 ? 1440 : d;
}
const key = (userId: string, date: string) => `${userId}|${date}`;

// Also embeddable inside the /hr/close hub (§Phase 2). `initialMonth` seeds the month; `embedded`
// drops the standalone page chrome. As a Next.js page these props are undefined.
export default function SchedulePage({
  initialMonth,
  embedded = false,
}: { initialMonth?: string; embedded?: boolean } = {}) {
  const t = useTranslations('hr.schedule');
  const isTh = useLocale() === 'th';
  const tt = (th: string, en: string) => (isTh ? th : en);

  const [stores, setStores] = useState<StoreOpt[]>([]);
  const [storeId, setStoreId] = useState('');
  // Roster scope (owner ask 2026-07-27): per STORE (default) or per COMPANY — company mode
  // reaches everyone incl. staff with no store (housekeepers/technicians); 'none' = no company.
  const [scopeKind, setScopeKind] = useState<'store' | 'company'>('store');
  const [companyId, setCompanyId] = useState('');
  const [companies, setCompanies] = useState<CompanyOpt[]>([]);
  const [month, setMonth] = useState<string>(() => initialMonth || todayBangkok().slice(0, 7));

  // Query params for the active scope — shared by load/save/publish/template calls.
  const scopeReady = scopeKind === 'store' ? !!storeId : !!companyId;
  const scopeBody = useMemo(
    () => (scopeKind === 'store' ? { store_id: storeId } : { company_id: companyId }),
    [scopeKind, storeId, companyId],
  );
  const scopeQS = scopeKind === 'store'
    ? `store_id=${encodeURIComponent(storeId)}`
    : `company_id=${encodeURIComponent(companyId)}`;

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [monthStatus, setMonthStatus] = useState<MonthStatus>('empty');
  const [holidays, setHolidays] = useState<{ holiday_date: string; name_th: string; name_en: string }[]>([]);
  // Employees with NO roster row at all this month — "nobody thought about them", which an empty
  // grid line hides (HR ask 2026-08-07).
  const [unscheduled, setUnscheduled] = useState<{ user_id: string; name: string; position_name: string | null }[]>([]);
  const [loading, setLoading] = useState(true);

  // Roster name display: real full name (hr_employees.full_name) ↔ nickname (display_name), login
  // username as the last resort either way (owner ask 2026-07-27). Sticky per browser.
  //
  // Defaults to the FULL name (owner ask 2026-08-17): the timesheet and payroll both lead with
  // ชื่อ-นามสกุล, and the roster defaulting to ชื่อเล่น was the one screen naming people
  // differently — which is exactly what made cross-checking the three HR screens hard.
  const [nameMode, setNameMode] = useState<'nick' | 'full'>('full');
  useEffect(() => {
    if (localStorage.getItem('hr-schedule-name-mode') === 'nick') setNameMode('nick');
  }, []);
  const switchNameMode = (mode: 'nick' | 'full') => {
    setNameMode(mode);
    localStorage.setItem('hr-schedule-name-mode', mode);
  };
  // Fallback follows the project-wide name rule: real name → nickname → the login account. `name`
  // already collapses to display_name||username server-side, so full mode degrades to the nickname
  // (not a raw login) for the few staff with no ชื่อ-นามสกุล on their HR record yet.
  const empName = useCallback(
    (emp: Employee) => (nameMode === 'full' ? emp.full_name || emp.name : emp.name) || emp.username || '—',
    [nameMode],
  );

  // Draft (unsaved) edits + the paint brush + which employees the bulk tools act on.
  const [draft, setDraft] = useState<Map<string, DraftVal>>(new Map());
  const [brush, setBrush] = useState<Brush>(null);
  const [selectedEmps, setSelectedEmps] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ label: '', start: '17:00', end: '01:00', color: '#6366f1' });
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  // Names of employees with no shift/day-off this month — shown as a non-blocking publish warning.
  const [publishWarn, setPublishWarn] = useState<string[] | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/hr/manageable-stores?capability=schedule');
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
    if (!scopeReady) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/hr/schedule?${scopeQS}&month=${month}`);
      if (!res.ok) throw new Error('load failed');
      const j = await res.json();
      setEmployees((j.employees ?? []) as Employee[]);
      setTemplates((j.templates ?? []) as Template[]);
      setEntries((j.entries ?? []) as Entry[]);
      setMonthStatus((j.monthStatus ?? 'empty') as MonthStatus);
      setHolidays((j.holidays ?? []) as { holiday_date: string; name_th: string; name_en: string }[]);
      setUnscheduled((j.unscheduled ?? []) as { user_id: string; name: string; position_name: string | null }[]);
      setCompanies((j.companies ?? []) as CompanyOpt[]);
    } catch {
      toast({ type: 'error', title: t('actionFailed') });
    } finally {
      setLoading(false);
    }
     
  }, [scopeReady, scopeQS, month, t]);

  useEffect(() => {
    load();
  }, [load]);

  // Switching scope/month is a fresh context — drop any draft + selection.
  useEffect(() => {
    setDraft(new Map());
    setSelectedEmps(new Set());
  }, [storeId, companyId, scopeKind, month]);

  // Keep a sensible default brush: first active shift; reset if the current one vanished.
  useEffect(() => {
    setBrush((b) => {
      if (b && b.kind === 'shift' && !templates.some((x) => x.id === b.id)) return templates[0] ? { kind: 'shift', id: templates[0].id } : null;
      if (!b && templates.length) return { kind: 'shift', id: templates[0].id };
      return b;
    });
  }, [templates]);


  // A store roster lists that venue's members; a payrun is generated per company + payroll group.
  // Where those disagree, say so on the row — HR was reading the difference as missing data
  // (owner report 2026-08-17). Company scope is single-company by definition, so no company chip.
  const mixedCompanies = useMemo(() => spansMultipleCompanies(employees), [employees]);
  const hasScopeChips = mixedCompanies || employees.some((e) => e.payroll_group_name);

  const days = useMemo(() => daysOfMonth(month), [month]);
  const tplById = useMemo(() => new Map(templates.map((x) => [x.id, x])), [templates]);
  // Configured public holidays → the roster auto-shows them as day-off (no manual entry).
  const holidayByDate = useMemo(
    () => new Map(holidays.map((h) => [h.holiday_date, isTh ? h.name_th : h.name_en])),
    [holidays, isTh]
  );
  const entryByCell = useMemo(() => {
    const m = new Map<string, Entry>();
    for (const e of entries) m.set(key(e.user_id, e.work_date), e);
    return m;
  }, [entries]);

  // Effective cell = draft override, else the saved entry.
  const effectiveCell = useCallback(
    (userId: string, date: string): { shift_template_id: string | null; is_day_off: boolean } | null => {
      const k = key(userId, date);
      if (draft.has(k)) {
        const d = draft.get(k)!;
        return 'clear' in d ? null : d;
      }
      const e = entryByCell.get(k);
      return e ? { shift_template_id: e.shift_template_id, is_day_off: e.is_day_off } : null;
    },
    [draft, entryByCell]
  );

  const brushToDraft = (b: Brush): DraftVal | null => {
    if (!b) return null;
    if (b.kind === 'clear') return { clear: true };
    if (b.kind === 'off') return { shift_template_id: null, is_day_off: true };
    return { shift_template_id: b.id, is_day_off: false };
  };

  // Paint one cell with the active brush.
  const paintCell = useCallback(
    (userId: string, date: string) => {
      const val = brushToDraft(brush);
      if (!val) {
        toast({ type: 'warning', title: tt('เลือกกะ (แปรง) ก่อน', 'Pick a shift (brush) first') });
        return;
      }
      setDraft((prev) => new Map(prev).set(key(userId, date), val));
    },
    [brush] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Bulk: fill the active brush for every selected employee on the chosen weekdays.
  const fillSelected = useCallback(
    (weekdays: number[]) => {
      const val = brushToDraft(brush);
      if (!val || selectedEmps.size === 0) return;
      const wd = new Set(weekdays);
      setDraft((prev) => {
        const next = new Map(prev);
        for (const uid of selectedEmps) for (const d of days) if (wd.has(getDay(d))) next.set(key(uid, d), val);
        return next;
      });
    },
    [brush, selectedEmps, days]  
  );

  // Bulk: stamp a 1-week pattern across the month for every selected employee.
  const applyPattern = useCallback(
    (pattern: PatternSlot[]) => {
      if (selectedEmps.size === 0) return;
      setDraft((prev) => {
        const next = new Map(prev);
        for (const uid of selectedEmps)
          for (const d of days) {
            const slot = pattern[getDay(d)];
            if (!slot) continue;
            next.set(key(uid, d), slot.kind === 'off' ? { shift_template_id: null, is_day_off: true } : { shift_template_id: slot.id, is_day_off: false });
          }
        return next;
      });
    },
    [selectedEmps, days]
  );

  const dirty = draft.size;

  const saveDraft = useCallback(async () => {
    if (dirty === 0) return;
    setSaving(true);
    try {
      const cells = [...draft.entries()].map(([k, val]) => {
        const [user_id, work_date] = k.split('|');
        return 'clear' in val
          ? { user_id, work_date, clear: true }
          : { user_id, work_date, shift_template_id: val.shift_template_id, is_day_off: val.is_day_off };
      });
      const res = await fetch('/api/hr/schedule/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...scopeBody, cells }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string; data?: { saved: number; skipped: number } };
      if (!res.ok) {
        toast({ type: 'error', title: t('saveFailed'), message: j?.error });
        return;
      }
      toast({
        type: 'success',
        title: tt(`บันทึกแล้ว ${j.data?.saved ?? 0} ช่อง`, `Saved ${j.data?.saved ?? 0} cells`),
        message: j.data?.skipped ? tt(`ข้ามงวดที่ปิดยอดแล้ว ${j.data.skipped} ช่อง`, `Skipped ${j.data.skipped} finalized cells`) : undefined,
      });
      setDraft(new Map());
      await load();
    } finally {
      setSaving(false);
    }
  }, [dirty, draft, scopeBody, load, t]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- shift templates (unchanged) ---
  const addTemplate = useCallback(async () => {
    if (!form.label.trim()) return;
    try {
      const res = await fetch('/api/hr/shift-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...scopeBody, label: form.label.trim(), start_time: form.start, end_time: form.end, color: form.color }),
      });
      if (!res.ok) throw new Error();
      setForm({ label: '', start: '17:00', end: '01:00', color: '#6366f1' });
      setShowAdd(false);
      await load();
    } catch {
      toast({ type: 'error', title: t('saveFailed') });
    }
  }, [form, scopeBody, load, t]);

  // --- publish ---
  // HQ publishes the roster (draft → submitted); employees see it immediately. The HR "acknowledge"
  // step was removed (owner: publishing is enough for now).
  const publishRoster = useCallback(async () => {
    try {
      const res = await fetch('/api/hr/schedule/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...scopeBody, month }),
      });
      if (!res.ok) throw new Error();
      toast({ type: 'success', title: t('submittedToast') });
      await load();
    } catch {
      toast({ type: 'error', title: t('actionFailed') });
    }
  }, [scopeBody, month, load, t]);

  // Publishing is allowed even if some staff have no shift yet — but warn first (owner ask). An
  // "unassigned" employee has no shift AND no day-off anywhere this month.
  const attemptSubmit = useCallback(() => {
    const unassigned = employees.filter((emp) => !days.some((d) => effectiveCell(emp.user_id, d))).map((e) => empName(e));
    if (unassigned.length > 0) {
      setPublishWarn(unassigned);
      return;
    }
    publishRoster();
  }, [employees, days, effectiveCell, publishRoster, empName]);

  // Live per-employee balance from the EFFECTIVE (draft-aware) cells, so day-off counts update as
  // you edit — before saving.
  const liveBalance = useMemo(() => {
    return employees.map((emp) => {
      let workDays = 0;
      let offDays = 0;
      let minutes = 0;
      for (const d of days) {
        const c = effectiveCell(emp.user_id, d);
        if (!c) continue;
        if (c.is_day_off) offDays++;
        else {
          workDays++;
          const tpl = c.shift_template_id ? tplById.get(c.shift_template_id) : null;
          if (tpl) minutes += shiftMinutes(tpl.start_time, tpl.end_time);
        }
      }
      return {
        user_id: emp.user_id,
        work_days: workDays,
        day_off_days: offDays,
        scheduled_minutes: minutes,
        standard_minutes: workDays * emp.work_hours_per_day * 60,
        off_target: emp.standard_days_off,
        off_delta: offDays - emp.standard_days_off,
      };
    });
  }, [employees, days, effectiveCell, tplById]);
  const balByUser = useMemo(() => new Map(liveBalance.map((b) => [b.user_id, b])), [liveBalance]);

  const allSelected = employees.length > 0 && employees.every((e) => selectedEmps.has(e.user_id));
  const toggleEmp = (uid: string) =>
    setSelectedEmps((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid); else next.add(uid);
      return next;
    });

  const statusText: Record<MonthStatus, string> = {
    empty: t('statusEmpty'), draft: t('statusDraft'), submitted: t('statusSubmitted'),
    acknowledged: t('statusAcknowledged'), mixed: t('statusMixed'),
  };
  const statusTone: Record<MonthStatus, StatusTone> = {
    empty: 'neutral', draft: 'warn', submitted: 'info', acknowledged: 'good', mixed: 'warn',
  };

  const brushLabel = (b: Brush): string =>
    !b ? '—' : b.kind === 'clear' ? t('clear') : b.kind === 'off' ? t('dayOff') : (tplById.get(b.id)?.label ?? '—');

  return (
    <div className={embedded ? 'space-y-4' : 'mx-auto max-w-7xl space-y-4 p-4'}>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <>
            <label className="flex flex-col text-xs font-medium text-gray-600 dark:text-gray-400">
              {/* Scope switch: roster by store (default) or by company — company mode reaches
                  staff with no store membership (แม่บ้าน/ช่าง) so EVERYONE is schedulable. */}
              <span className="inline-flex rounded-md bg-gray-100 p-0.5 dark:bg-gray-700">
                {([
                  { kind: 'store', label: tt('สาขา', 'Store') },
                  { kind: 'company', label: tt('บริษัท', 'Company') },
                ] as const).map(({ kind, label }) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => {
                      setScopeKind(kind);
                      if (kind === 'company' && !companyId) setCompanyId(companies[0]?.id ?? 'none');
                    }}
                    className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
                      scopeKind === kind
                        ? 'bg-white text-indigo-600 shadow-sm dark:bg-gray-800 dark:text-indigo-300'
                        : 'text-gray-500 dark:text-gray-400'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </span>
              {scopeKind === 'store' ? (
                <select value={storeId} onChange={(e) => setStoreId(e.target.value)} className="control mt-1">
                  {stores.length === 0 && <option value="">{t('noStores')}</option>}
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>{s.store_name}</option>
                  ))}
                </select>
              ) : (
                <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} className="control mt-1">
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                  <option value="none">{tt('— ไม่ระบุบริษัท —', '— No company —')}</option>
                </select>
              )}
            </label>
            <label className="flex flex-col text-xs font-medium text-gray-600 dark:text-gray-400">
              {t('filterMonth')}
              <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="control mt-1" />
            </label>
          </>
        }
      />

      {/* status + publish (publish acts on SAVED cells → disabled while a draft is pending) */}
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={statusTone[monthStatus]} label={`${t('statusLabel')}: ${statusText[monthStatus]}`} />
        {dirty > 0 && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
            {tt(`ยังไม่บันทึก ${dirty} ช่อง`, `${dirty} unsaved`)}
          </span>
        )}
        <div className="flex-1" />
        <Button size="sm" onClick={attemptSubmit} disabled={dirty > 0 || monthStatus === 'empty'}>
          {t('submitToHr')}
        </Button>
      </div>

      {/* Nobody has been rostered for these people this month. Called out rather than left as an
          empty grid line, which is indistinguishable from a line that was considered and left
          blank (HR ask 2026-08-07). */}
      {unscheduled.length > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-800/60 dark:bg-amber-900/15 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0">
            <p className="font-semibold">
              {tt(
                `ยังไม่ได้จัดตาราง ${unscheduled.length} คน`,
                `${unscheduled.length} not scheduled yet`
              )}
            </p>
            <p className="mt-0.5">
              {unscheduled
                .map((u) => (u.position_name ? `${u.name} (${u.position_name})` : u.name))
                .join(' · ')}
            </p>
          </div>
        </div>
      )}

      {/* Why this roster and the payrun list different people — stated once, then chipped per row. */}
      {!loading && hasScopeChips && (
        <p className="rounded-xl border border-gray-200 bg-gray-50/70 px-3 py-2 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-800/40 dark:text-gray-400">
          {tt(
            'ตารางนี้ยึดตามสาขาที่พนักงานสังกัด ส่วนเงินเดือนออกเป็นราย “บริษัท” และแยกตาม “กลุ่มเงินเดือน” — คนที่มีป้ายกำกับท้ายชื่อจะไปอยู่ใน payrun คนละใบกับสาขานี้',
            'This roster is keyed on venue membership; a payrun is generated per company and split by payroll group — the chipped rows are paid on a different payrun than this venue’s.'
          )}
        </p>
      )}

      {/* shift templates strip + brush picker */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{t('shifts')}:</span>
        {templates.length === 0 && <span className="text-xs text-gray-400">{t('noTemplates')}</span>}
        {templates.map((tpl) => {
          const active = brush?.kind === 'shift' && brush.id === tpl.id;
          return (
            <span key={tpl.id}
              className={`inline-flex items-center gap-1.5 rounded-full border bg-white px-2.5 py-1 text-xs dark:bg-gray-800 ${active ? 'border-indigo-500 ring-2 ring-indigo-300 dark:ring-indigo-700' : 'border-gray-200 dark:border-gray-700'}`}>
              <button type="button" onClick={() => setBrush({ kind: 'shift', id: tpl.id })} className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: tpl.color || '#6366f1' }} />
                <span className="font-medium text-gray-800 dark:text-gray-200">{tpl.label}</span>
                <span className="tabular-nums text-gray-400">{hhmm(tpl.start_time)}–{hhmm(tpl.end_time)}</span>
              </button>
              <button type="button" onClick={() => setEditingTemplate(tpl)} className="text-gray-300 hover:text-indigo-500" aria-label={tt('แก้ไขกะ', 'Edit shift')}>
                <Pencil className="h-3 w-3" />
              </button>
            </span>
          );
        })}
        {/* OFF + Clear brushes */}
        <button type="button" onClick={() => setBrush({ kind: 'off' })}
          className={`rounded-full border px-2.5 py-1 text-xs font-medium ${brush?.kind === 'off' ? 'border-indigo-500 bg-indigo-50 text-indigo-700 ring-2 ring-indigo-300 dark:bg-indigo-900/30 dark:text-indigo-200 dark:ring-indigo-700' : 'border-gray-300 text-gray-600 dark:border-gray-600 dark:text-gray-300'}`}>
          {t('dayOff')}
        </button>
        <button type="button" onClick={() => setBrush({ kind: 'clear' })}
          className={`rounded-full border px-2.5 py-1 text-xs font-medium ${brush?.kind === 'clear' ? 'border-red-400 bg-red-50 text-red-600 ring-2 ring-red-200 dark:bg-red-900/20' : 'border-gray-300 text-gray-600 dark:border-gray-600 dark:text-gray-300'}`}>
          {t('clear')}
        </button>
        <button type="button" onClick={() => setShowAdd((v) => !v)}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-gray-300 px-2.5 py-1 text-xs text-gray-500 hover:border-indigo-400 hover:text-indigo-600 dark:border-gray-600">
          <Plus className="h-3 w-3" /> {t('addShift')}
        </button>

        {/* nickname ↔ full-name display toggle (missing → login username) */}
        <div className="ml-auto inline-flex rounded-lg bg-gray-100 p-0.5 text-xs dark:bg-gray-700">
          {([
            { mode: 'nick', label: tt('ชื่อเล่น', 'Nickname') },
            { mode: 'full', label: tt('ชื่อ-นามสกุล', 'Full name') },
          ] as const).map(({ mode, label }) => (
            <button
              key={mode}
              type="button"
              onClick={() => switchNameMode(mode)}
              className={`rounded-md px-2 py-1 font-medium transition-colors ${
                nameMode === mode
                  ? 'bg-white text-indigo-600 shadow-sm dark:bg-gray-800 dark:text-indigo-300'
                  : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {showAdd && (
        <div className="flex flex-wrap items-end gap-2 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/50">
          <input placeholder={t('shiftLabel')} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })}
            className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white" />
          <input type="time" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })}
            className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white" />
          <input type="time" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })}
            className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white" />
          <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })}
            className="h-9 w-10 rounded border border-gray-300 dark:border-gray-600" />
          <Button size="sm" onClick={addTemplate}>{t('add')}</Button>
          <Button size="sm" variant="ghost" onClick={() => { setShowAdd(false); setForm({ label: '', start: '17:00', end: '01:00', color: '#6366f1' }); }}>
            {tt('ยกเลิก', 'Cancel')}
          </Button>
          {/* The time picker shows AM/PM under an en-US locale — naming a shift "10:00" while
              picking 10:00 PM stores 22:00 and late detection then reads 0. Say so up front. */}
          <p className="w-full text-xs text-gray-500 dark:text-gray-400">
            {tt('เวลาที่ระบบจะใช้คำนวณสาย', 'Times used for late detection')}:{' '}
            <span className="font-medium tabular-nums text-gray-700 dark:text-gray-200">{form.start}–{form.end}</span>
            <span className="ml-1 text-gray-400 dark:text-gray-500">({to12h(form.start)} – {to12h(form.end)})</span>
          </p>
          {labelTimeMismatch(form.label, form.start) && (
            <p className="w-full rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-800/60 dark:bg-amber-900/20 dark:text-amber-200">
              {tt(
                `ชื่อกะขึ้นต้นด้วย ${labelTimeMismatch(form.label, form.start)} แต่เวลาเริ่มที่เลือกคือ ${form.start} (${to12h(form.start)}) — ระบบคำนวณสายจาก ${form.start}`,
                `The name starts with ${labelTimeMismatch(form.label, form.start)} but the picked start is ${form.start} (${to12h(form.start)}) — lateness is measured from ${form.start}`
              )}
            </p>
          )}
        </div>
      )}

      {/* bulk fill tools */}
      {!loading && employees.length > 0 && (
        <ScheduleFillTools
          isTh={isTh}
          templates={templates}
          selectedCount={selectedEmps.size}
          hasBrush={!!brush}
          onFillSelected={fillSelected}
          onApplyPattern={applyPattern}
        />
      )}

      {/* save bar (sticky) */}
      {dirty > 0 && (
        <div className="sticky top-2 z-20 flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 shadow-sm dark:border-amber-700 dark:bg-amber-900/30">
          <span className="text-sm font-medium text-amber-800 dark:text-amber-200">
            {tt(`มีการเปลี่ยนแปลง ${dirty} ช่อง`, `${dirty} unsaved change(s)`)}
          </span>
          <span className="text-xs text-amber-600 dark:text-amber-300">· {tt('แปรง', 'Brush')}: {brushLabel(brush)}</span>
          <div className="flex-1" />
          <Button size="sm" variant="ghost" onClick={() => setDraft(new Map())} icon={<Undo2 className="h-4 w-4" />}>
            {tt('ยกเลิกร่าง', 'Discard')}
          </Button>
          <Button size="sm" onClick={saveDraft} isLoading={saving} icon={<Save className="h-4 w-4" />}>
            {tt('บันทึก', 'Save')}
          </Button>
        </div>
      )}

      {/* roster grid */}
      {loading ? (
        <div className="flex items-center justify-center py-10 text-gray-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : employees.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-400 dark:border-gray-700">{t('noEmployees')}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
          <table className="min-w-full border-collapse text-xs">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-800">
                <th className="sticky left-0 z-10 bg-gray-50 px-2 py-2 text-left font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={allSelected}
                      onChange={(e) => setSelectedEmps(e.target.checked ? new Set(employees.map((x) => x.user_id)) : new Set())}
                      className="h-3.5 w-3.5 rounded border-gray-300 text-indigo-600" />
                    {t('employee')}
                  </label>
                </th>
                {days.map((d) => {
                  const holiday = holidayByDate.get(d);
                  return (
                    <th key={d} className={`min-w-[38px] px-1 py-2 text-center font-medium ${holiday ? 'text-rose-500 dark:text-rose-400' : 'text-gray-500 dark:text-gray-400'}`} title={holiday || undefined}>
                      <div className="text-[10px] uppercase">{WEEKDAYS[getDay(d)]}</div>
                      <div className="tabular-nums">{Number(d.split('-')[2])}</div>
                      {holiday && <div className="mx-auto mt-0.5 h-1 w-1 rounded-full bg-rose-500" />}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {employees.map((emp) => (
                <tr key={emp.user_id} className="border-t border-gray-100 dark:border-gray-700/50">
                  <td className="sticky left-0 z-10 whitespace-nowrap bg-white px-2 py-1.5 font-medium text-gray-800 dark:bg-gray-900 dark:text-gray-200">
                    <label className="flex items-center gap-1.5">
                      <input type="checkbox" checked={selectedEmps.has(emp.user_id)} onChange={() => toggleEmp(emp.user_id)}
                        className="h-3.5 w-3.5 rounded border-gray-300 text-indigo-600" />
                      {empName(emp)}
                      <PayrollScopeChips emp={emp} showCompany={mixedCompanies} isTh={isTh} />
                      {/* Company scope is sorted by position — show it so the grouping reads */}
                      {scopeKind === 'company' && (
                        <span className={`text-[10px] ${emp.position_name ? 'text-gray-400' : 'text-amber-500'}`}>
                          · {emp.position_name || tt('ไม่มีตำแหน่ง', 'no position')}
                        </span>
                      )}
                      {emp.end_date && (
                        <span
                          className="inline-flex shrink-0 items-center rounded-full bg-rose-50 px-1.5 py-0.5 text-[9px] font-medium text-rose-600 dark:bg-rose-900/30 dark:text-rose-400"
                          title={`${tt('วันทำงานสุดท้าย', 'Last working day')}: ${emp.end_date}`}
                        >
                          {tt('พ้นสภาพ', 'departed')}
                        </span>
                      )}
                    </label>
                  </td>
                  {days.map((d) => {
                    const c = effectiveCell(emp.user_id, d);
                    const tpl = c?.shift_template_id ? tplById.get(c.shift_template_id) : null;
                    const isDirty = draft.has(key(emp.user_id, d));
                    const holiday = holidayByDate.get(d);
                    // A holiday with no explicit assignment shows an auto day-off (rose "หยุด")
                    // — a manual shift/day-off still wins, so HR can override for anyone who works it.
                    const autoHoliday = !c && holiday;
                    return (
                      <td key={d} className="p-0.5 text-center">
                        <button type="button" onClick={() => paintCell(emp.user_id, d)}
                          className={`flex h-8 w-full items-center justify-center rounded ${isDirty ? 'ring-2 ring-amber-400' : ''} ${
                            c
                              ? (c.is_day_off ? 'bg-gray-100 text-gray-400 dark:bg-gray-700/50' : 'text-white')
                              : autoHoliday
                                ? 'bg-rose-50 text-rose-400 dark:bg-rose-900/20 dark:text-rose-300'
                                : 'bg-transparent hover:bg-gray-100 dark:hover:bg-gray-700/50'
                          }`}
                          style={!c || c.is_day_off ? undefined : { backgroundColor: tpl?.color || '#6366f1' }}
                          /* Include the real start–end on the roster cell: the label alone hid a
                             shift named "10:00" that actually started 22:00, so nothing looked wrong
                             until late detection silently read 0 minutes. */
                          title={autoHoliday ? holiday : c?.is_day_off ? t('dayOff') : tpl ? `${tpl.label} · ${hhmm(tpl.start_time)}–${hhmm(tpl.end_time)}` : undefined}>
                          {c
                            ? (c.is_day_off ? <span className="text-[10px]">OFF</span> : <span className="hidden truncate px-0.5 text-[10px] font-medium sm:inline">{tpl?.label?.slice(0, 3)}</span>)
                            : autoHoliday
                              ? <span className="text-[9px]">{isTh ? 'หยุด' : 'PH'}</span>
                              : ''}
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

      {/* balance panel (live from draft) */}
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
                  <th className="px-3 py-1.5">{t('offDays')} / {t('offTarget')}</th>
                  <th className="px-3 py-1.5">{t('hours')} / {t('standardHours')}</th>
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
                      <td className="px-3 py-1.5 font-medium text-gray-800 dark:text-gray-200">
                        {empName(emp)}
                        <PayrollScopeChips emp={emp} showCompany={mixedCompanies} isTh={isTh} />
                      </td>
                      <td className="px-3 py-1.5 tabular-nums text-gray-600 dark:text-gray-400">{b?.work_days ?? 0}</td>
                      <td className={`px-3 py-1.5 tabular-nums ${offBad ? 'font-semibold text-red-600 dark:text-red-400' : 'text-gray-600 dark:text-gray-400'}`}>
                        {b?.day_off_days ?? 0} / {b?.off_target ?? 0}
                      </td>
                      <td className="px-3 py-1.5 tabular-nums text-gray-600 dark:text-gray-400">{hrs} / {std}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* edit/delete a shift template */}
      {editingTemplate && (
        <ShiftModal template={editingTemplate} isTh={isTh} onClose={() => setEditingTemplate(null)} onSaved={load} />
      )}

      {/* non-blocking warning: publishing while some staff have no schedule yet */}
      {publishWarn && (
        <Modal isOpen onClose={() => setPublishWarn(null)} title={tt('ยังจัดกะไม่ครบทุกคน', 'Some staff are unassigned')} size="sm">
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800/60 dark:bg-amber-900/20 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>{tt(`พนักงาน ${publishWarn.length} คนยังไม่ถูกจัดกะเลยเดือนนี้`, `${publishWarn.length} employee(s) have no schedule this month`)}</span>
            </div>
            <ul className="max-h-40 overflow-y-auto rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-300">
              {publishWarn.map((n) => (<li key={n}>· {n}</li>))}
            </ul>
            <p className="text-xs text-gray-400">{tt('เผยแพร่ต่อได้ และกลับมาแก้ไขภายหลังได้', 'You can publish anyway and come back to edit later')}</p>
            <ModalFooter className="px-0 pb-0">
              <Button variant="ghost" onClick={() => setPublishWarn(null)}>{tt('กลับไปแก้', 'Back to edit')}</Button>
              <Button onClick={() => { setPublishWarn(null); publishRoster(); }}>
                {tt('เผยแพร่ต่อไป', 'Publish anyway')}
              </Button>
            </ModalFooter>
          </div>
        </Modal>
      )}
    </div>
  );
}
