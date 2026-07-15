'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { Loader2, X } from 'lucide-react';
import { Modal, ModalFooter, Button, toast } from '@/components/ui';
import { cn } from '@/lib/utils/cn';
import { useLeaveTypes } from '@/hooks/use-leave-types';

type Status = 'normal' | 'absent' | 'leave' | 'late' | 'dayoff';
type Brush = Status | 'ot' | 'clear';
interface Cell { status: Status | 'clear'; late: number; ot: number; leave_type_id?: string | null }
interface Employee { user_id: string; name: string }
interface DetailTarget { user_id: string; name: string; date: string }

const STATUSES: Status[] = ['normal', 'absent', 'leave', 'late', 'dayoff'];

function rangeDates(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = new Date(`${from}T00:00:00Z`).getTime();
  const end = new Date(`${to}T00:00:00Z`).getTime();
  let guard = 0;
  while (cur <= end && guard < 80) { out.push(new Date(cur).toISOString().slice(0, 10)); cur += 86_400_000; guard++; }
  return out;
}

// Bulk timesheet grid (owner ask 2026-07-08): employees × days as coloured rounded blocks. Fill fast
// with a brush (whole grid / row via the name / column via the date), or click any block to open a
// detail panel and set exact status + late + OT for that person-day. Each cell → an
// hr_timesheet_overrides row, so the derived timesheet (and pay) recomputes.
export function BulkBackfillModal({
  isOpen, storeId, storeName, defaultFrom, defaultTo, onClose, onDone,
}: {
  isOpen: boolean; storeId: string; storeName: string; defaultFrom: string; defaultTo: string;
  onClose: () => void; onDone: () => void;
}) {
  const isTh = useLocale() === 'th';
  const L = isTh
    ? { title: 'ลงเวลาย้อนหลัง (ตารางทั้งสาขา)', desc: (s: string) => `สาขา “${s}” — เลือกสถานะแล้วเติมทั้งหมด/ทั้งแถว/ทั้งคอลัมน์ หรือคลิกช่องเพื่อดู–แก้รายวัน`,
        brush: 'สถานะที่จะระบาย', lateMin: 'สาย (นาที)', otMin: 'OT (นาที)', fillAll: 'เติมทั้งหมด', legend: 'สีสถานะ',
        rowHint: 'คลิกชื่อ = เติมทั้งแถว', colHint: 'คลิกวันที่ = เติมทั้งคอลัมน์', cellHint: 'คลิกเพื่อดู/แก้รายวัน',
        detail: 'รายละเอียดวัน', empty: 'ว่าง (ไม่ระบุ)', apply: 'ตกลง', close: 'ปิด', leaveType: 'ประเภทการลา', pickType: 'เลือกประเภทการลาก่อนบันทึก',
        save: 'บันทึก', cancel: 'ยกเลิก', saved: (w: number, c: number) => `บันทึกแล้ว: ${w} รายการ${c ? ` (ล้าง ${c})` : ''}`, none: 'ยังไม่ได้ระบุอะไร', fail: 'บันทึกไม่สำเร็จ', loadFail: 'โหลดไม่สำเร็จ', noEmp: 'ไม่มีพนักงานในสาขานี้', emp: 'พนักงาน',
        s: { normal: 'ปกติ', absent: 'ขาด', leave: 'ลา', late: 'มาสาย', dayoff: 'วันหยุด', ot: 'OT', clear: 'ล้าง' } as Record<Brush, string>, wd: ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'] }
    : { title: 'Bulk backfill (branch grid)', desc: (s: string) => `“${s}” — fill all/row/column with a status, or click a cell to view & edit the day`,
        brush: 'Status to paint', lateMin: 'Late (min)', otMin: 'OT (min)', fillAll: 'Fill all', legend: 'Legend',
        rowHint: 'Click name = fill row', colHint: 'Click date = fill column', cellHint: 'Click to view/edit day',
        detail: 'Day detail', empty: 'Empty', apply: 'OK', close: 'Close', leaveType: 'Leave type', pickType: 'Pick a leave type before saving',
        save: 'Save', cancel: 'Cancel', saved: (w: number, c: number) => `Saved: ${w}${c ? ` (cleared ${c})` : ''}`, none: 'Nothing set', fail: 'Save failed', loadFail: 'Load failed', noEmp: 'No staff in this store', emp: 'Employee',
        s: { normal: 'Normal', absent: 'Absent', leave: 'Leave', late: 'Late', dayoff: 'Day off', ot: 'OT', clear: 'Clear' } as Record<Brush, string>, wd: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] };

  const STYLE: Record<Status, { block: string; glyph: string; dot: string }> = {
    normal: { block: 'bg-emerald-400/90 text-white ring-emerald-500', glyph: isTh ? 'ป' : 'N', dot: 'bg-emerald-400' },
    absent: { block: 'bg-red-400/90 text-white ring-red-500', glyph: isTh ? 'ข' : 'A', dot: 'bg-red-400' },
    leave: { block: 'bg-blue-400/90 text-white ring-blue-500', glyph: isTh ? 'ล' : 'L', dot: 'bg-blue-400' },
    late: { block: 'bg-amber-400/90 text-white ring-amber-500', glyph: isTh ? 'ส' : 'T', dot: 'bg-amber-400' },
    dayoff: { block: 'bg-gray-300 text-gray-600 ring-gray-400 dark:bg-gray-600 dark:text-gray-200', glyph: isTh ? 'ห' : 'O', dot: 'bg-gray-400' },
  };
  const BRUSH_TONE: Record<Brush, string> = {
    normal: 'border-emerald-400 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200',
    absent: 'border-red-400 bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-200',
    leave: 'border-blue-400 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200',
    late: 'border-amber-400 bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200',
    dayoff: 'border-gray-400 bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
    ot: 'border-violet-400 bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-200',
    clear: 'border-gray-300 bg-white text-gray-500 dark:bg-gray-800 dark:text-gray-400',
  };

  const dates = useMemo(() => rangeDates(defaultFrom, defaultTo), [defaultFrom, defaultTo]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [grid, setGrid] = useState<Map<string, Cell>>(new Map());
  const [brush, setBrush] = useState<Brush>('normal');
  const [lateVal, setLateVal] = useState(30);
  const [otVal, setOtVal] = useState(120);
  const [leaveTypeId, setLeaveTypeId] = useState('');
  const [detail, setDetail] = useState<DetailTarget | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const { leaveTypes } = useLeaveTypes(companyId);
  useEffect(() => {
    // Default the leave-type picker to the first configured type once they load.
    setLeaveTypeId((prev) => prev || leaveTypes[0]?.id || '');
  }, [leaveTypes]);
  const leaveName = (id: string | null | undefined) => {
    const lt = leaveTypes.find((x) => x.id === id);
    return lt ? (isTh ? lt.name_th : lt.name_en) : isTh ? 'ลา' : 'Leave';
  };

  const load = useCallback(async () => {
    setLoading(true); setDetail(null);
    try {
      const res = await fetch(`/api/hr/timesheet/bulk-backfill?store_id=${storeId}&from=${defaultFrom}&to=${defaultTo}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || L.loadFail);
      setEmployees((json.data?.employees ?? []) as Employee[]);
      setCompanyId((json.data?.company_id ?? null) as string | null);
      const m = new Map<string, Cell>();
      const seed = (json.data?.cells ?? {}) as Record<string, { status: Status; late: number; ot: number; leave_type_id?: string }>;
      for (const [k, v] of Object.entries(seed)) m.set(k, { status: v.status, late: v.late, ot: v.ot, leave_type_id: v.leave_type_id ?? null });
      setGrid(m);
    } catch (e) {
      toast({ type: 'error', title: e instanceof Error ? e.message : L.loadFail });
    } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId, defaultFrom, defaultTo]);

  useEffect(() => { if (isOpen && storeId) load(); }, [isOpen, storeId, load]);

  const brushCell = useCallback((cur: Cell | undefined): Cell | null => {
    switch (brush) {
      case 'clear': return null;
      case 'normal': return { status: 'normal', late: 0, ot: cur?.ot ?? 0 };
      case 'absent': return { status: 'absent', late: 0, ot: 0 };
      case 'leave': return { status: 'leave', late: 0, ot: cur?.ot ?? 0, leave_type_id: leaveTypeId || cur?.leave_type_id || null };
      case 'dayoff': return { status: 'dayoff', late: 0, ot: 0 };
      case 'late': return { status: 'late', late: lateVal, ot: cur?.ot ?? 0 };
      case 'ot': return { status: cur && cur.status !== 'clear' ? cur.status : 'normal', late: cur?.late ?? 0, ot: otVal };
    }
  }, [brush, lateVal, otVal, leaveTypeId]);

  const fillKeys = useCallback((keys: string[]) => {
    setGrid((prev) => {
      const next = new Map(prev);
      for (const k of keys) { const c = brushCell(next.get(k)); if (c) next.set(k, c); else next.delete(k); }
      return next;
    });
  }, [brushCell]);

  const setCell = useCallback((key: string, cell: Cell | null) => {
    setGrid((prev) => { const next = new Map(prev); if (cell) next.set(key, cell); else next.delete(key); return next; });
  }, []);

  const cellKeys = useMemo(() => employees.flatMap((e) => dates.map((d) => `${e.user_id}|${d}`)), [employees, dates]);

  const save = async () => {
    const cells: Record<string, unknown>[] = [];
    let missingType = 0;
    for (const [k, v] of grid) {
      const [user_id, business_date] = k.split('|');
      if (v.status === 'clear') cells.push({ user_id, business_date, status: 'clear' });
      else if (v.status === 'leave') {
        if (!v.leave_type_id) { missingType++; continue; }
        cells.push({ user_id, business_date, status: 'leave', leave_type_id: v.leave_type_id });
      } else cells.push({ user_id, business_date, status: v.status, late_min: v.late || undefined, ot_min: v.ot || undefined });
    }
    if (missingType > 0) { toast({ type: 'warning', title: L.pickType }); return; }
    if (cells.length === 0) { toast({ type: 'warning', title: L.none }); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/hr/timesheet/bulk-backfill', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ store_id: storeId, cells }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || L.fail);
      toast({ type: 'success', title: L.saved(json.data?.written ?? 0, json.data?.cleared ?? 0) });
      onDone();
    } catch (e) {
      toast({ type: 'error', title: e instanceof Error ? e.message : L.fail });
    } finally { setSaving(false); }
  };

  const BRUSHES: Brush[] = ['normal', 'absent', 'leave', 'late', 'dayoff', 'ot', 'clear'];
  const detailKey = detail ? `${detail.user_id}|${detail.date}` : '';
  const detailCell = detail ? grid.get(detailKey) : undefined;
  const detailStatus = detailCell && detailCell.status !== 'clear' ? detailCell.status : null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={L.title} size="full">
      <p className="text-sm text-gray-500 dark:text-gray-400">{L.desc(storeName)}</p>

      {/* Controls */}
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div>
          <p className="mb-1 text-xs font-semibold text-gray-600 dark:text-gray-300">{L.brush}</p>
          <div className="flex flex-wrap gap-1.5">
            {BRUSHES.map((b) => (
              <button key={b} type="button" onClick={() => setBrush(b)} aria-pressed={brush === b}
                className={cn('rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors',
                  brush === b ? BRUSH_TONE[b] : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400')}>
                {L.s[b]}
              </button>
            ))}
          </div>
        </div>
        {brush === 'leave' && (
          <label className="flex flex-col text-[11px] font-medium text-gray-500 dark:text-gray-400">{L.leaveType}
            <select value={leaveTypeId} onChange={(e) => setLeaveTypeId(e.target.value)} className="control mt-0.5 w-40">
              {leaveTypes.length === 0 && <option value="">—</option>}
              {leaveTypes.map((lt) => (
                <option key={lt.id} value={lt.id}>{isTh ? lt.name_th : lt.name_en}</option>
              ))}
            </select>
          </label>
        )}
        <label className="flex flex-col text-[11px] font-medium text-gray-500 dark:text-gray-400">{L.lateMin}
          <input type="number" min={0} value={lateVal} onChange={(e) => setLateVal(Math.max(0, Number(e.target.value) || 0))} className="control mt-0.5 w-20" />
        </label>
        <label className="flex flex-col text-[11px] font-medium text-gray-500 dark:text-gray-400">{L.otMin}
          <input type="number" min={0} value={otVal} onChange={(e) => setOtVal(Math.max(0, Number(e.target.value) || 0))} className="control mt-0.5 w-20" />
        </label>
        <Button size="sm" variant="outline" onClick={() => fillKeys(cellKeys)} disabled={loading || employees.length === 0}>
          {L.fillAll} · {L.s[brush]}
        </Button>
      </div>

      {/* Legend */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500 dark:text-gray-400">
        <span className="font-semibold">{L.legend}:</span>
        {STATUSES.map((s) => (
          <span key={s} className="inline-flex items-center gap-1"><i className={cn('h-2.5 w-2.5 rounded-sm', STYLE[s].dot)} />{L.s[s]}</span>
        ))}
        <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm bg-violet-400" />OT</span>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : employees.length === 0 ? (
        <p className="py-12 text-center text-sm text-gray-400">{L.noEmp}</p>
      ) : (
        <div className="mt-3 max-h-[54vh] overflow-auto rounded-xl border border-gray-200 dark:border-gray-700">
          <table className="border-separate border-spacing-0 text-xs">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="sticky left-0 z-20 min-w-[8.5rem] border-b border-r border-gray-200 bg-gray-50 px-2 py-1.5 text-left font-semibold text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">{L.emp}</th>
                {dates.map((d) => {
                  const wd = new Date(`${d}T00:00:00`).getDay();
                  const [, mm, dd] = d.split('-');
                  const weekend = wd === 0 || wd === 6;
                  return (
                    <th key={d} onClick={() => fillKeys(employees.map((e) => `${e.user_id}|${d}`))} title={L.colHint}
                      className={cn('cursor-pointer border-b border-gray-200 px-0.5 py-1 text-center font-medium hover:bg-indigo-50 dark:border-gray-700 dark:hover:bg-indigo-900/20',
                        weekend ? 'bg-gray-100 text-rose-400 dark:bg-gray-800/80' : 'bg-gray-50 text-gray-500 dark:bg-gray-800')}>
                      <div className="tabular-nums">{Number(dd)}</div>
                      <div className="text-[9px] opacity-70">{L.wd[wd]}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.user_id}>
                  <td onClick={() => fillKeys(dates.map((d) => `${e.user_id}|${d}`))} title={L.rowHint}
                    className="sticky left-0 z-[5] min-w-[8.5rem] max-w-[8.5rem] cursor-pointer truncate border-b border-r border-gray-200 bg-white px-2 py-1 font-medium text-gray-800 hover:bg-indigo-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-indigo-900/20">
                    {e.name}
                  </td>
                  {dates.map((d) => {
                    const key = `${e.user_id}|${d}`;
                    const c = grid.get(key);
                    const st = c && c.status !== 'clear' ? c.status : null;
                    const sel = detailKey === key;
                    return (
                      <td key={d} className="border-b border-gray-100 p-0.5 text-center dark:border-gray-700/60">
                        <button type="button" onClick={() => setDetail({ user_id: e.user_id, name: e.name, date: d })}
                          title={st ? `${st === 'leave' ? leaveName(c?.leave_type_id) : L.s[st]}${c && c.late ? ` · ${L.lateMin} ${c.late}` : ''}${c && c.ot ? ` · OT ${c.ot}` : ''}` : L.cellHint}
                          className={cn('relative mx-auto flex h-7 w-7 items-center justify-center rounded-lg text-[11px] font-bold ring-1 transition-transform hover:scale-110',
                            st ? STYLE[st].block : 'bg-gray-50 text-transparent ring-gray-200 hover:bg-gray-100 dark:bg-gray-800 dark:ring-gray-700',
                            sel && 'ring-2 ring-indigo-500 ring-offset-1 dark:ring-offset-gray-900')}>
                          {st ? STYLE[st].glyph : '·'}
                          {c && c.ot > 0 && <i className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-violet-500 ring-1 ring-white dark:ring-gray-900" />}
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

      {/* Per-day detail editor */}
      {detail && (
        <div className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50/50 p-3 dark:border-indigo-800 dark:bg-indigo-900/15">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">{L.detail} — {detail.name} · {(() => { const [, mm, dd] = detail.date.split('-'); return `${Number(dd)}/${Number(mm)}`; })()}</span>
            <button type="button" onClick={() => setDetail(null)} className="rounded p-1 text-gray-400 hover:bg-white hover:text-gray-600 dark:hover:bg-gray-800"><X className="h-4 w-4" /></button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {STATUSES.map((s) => (
              <button key={s} type="button"
                onClick={() => setCell(detailKey, { status: s, late: s === 'late' ? (detailCell?.late || lateVal) : 0, ot: detailCell?.ot ?? 0, leave_type_id: s === 'leave' ? (detailCell?.leave_type_id || leaveTypeId || null) : null })}
                className={cn('rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors',
                  detailStatus === s ? BRUSH_TONE[s] : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400')}>
                {L.s[s]}
              </button>
            ))}
            <button type="button" onClick={() => setCell(detailKey, null)}
              className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800">{L.s.clear}</button>
          </div>
          {detailStatus === 'leave' && (
            <label className="mt-2 flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">{L.leaveType}
              <select value={detailCell?.leave_type_id ?? ''} onChange={(ev) => setCell(detailKey, { status: 'leave', late: 0, ot: detailCell?.ot ?? 0, leave_type_id: ev.target.value || null })} className="control w-40">
                {leaveTypes.length === 0 && <option value="">—</option>}
                {leaveTypes.map((lt) => (
                  <option key={lt.id} value={lt.id}>{isTh ? lt.name_th : lt.name_en}</option>
                ))}
              </select>
            </label>
          )}
          <div className="mt-2 flex flex-wrap gap-3">
            <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">{L.lateMin}
              <input type="number" min={0} value={detailCell?.late ?? 0}
                onChange={(ev) => { const late = Math.max(0, Number(ev.target.value) || 0); const base = detailStatus ?? 'normal'; setCell(detailKey, { status: late > 0 && base === 'normal' ? 'late' : base, late, ot: detailCell?.ot ?? 0 }); }}
                className="control w-20" />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">{L.otMin}
              <input type="number" min={0} value={detailCell?.ot ?? 0}
                onChange={(ev) => { const ot = Math.max(0, Number(ev.target.value) || 0); setCell(detailKey, { status: detailStatus ?? 'normal', late: detailCell?.late ?? 0, ot }); }}
                className="control w-20" />
            </label>
          </div>
        </div>
      )}

      <ModalFooter>
        <Button variant="ghost" onClick={onClose} disabled={saving}>{L.cancel}</Button>
        <Button onClick={save} isLoading={saving} disabled={saving || loading}>{L.save}</Button>
      </ModalFooter>
    </Modal>
  );
}
