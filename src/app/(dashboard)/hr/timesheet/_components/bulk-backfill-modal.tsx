'use client';

import { useState } from 'react';
import { useLocale } from 'next-intl';
import { Modal, ModalFooter, Button, toast } from '@/components/ui';
import { cn } from '@/lib/utils/cn';

type Status = 'normal' | 'absent' | 'leave' | 'late' | 'dayoff';

// Bulk backfill a whole branch's timesheet for a date range (owner ask 2026-07-08) — for periods
// with no punch data. Self-contained bilingual labels. Writes via POST /api/hr/timesheet/bulk-backfill.
export function BulkBackfillModal({
  isOpen, storeId, storeName, defaultFrom, defaultTo, onClose, onDone,
}: {
  isOpen: boolean;
  storeId: string;
  storeName: string;
  defaultFrom: string;
  defaultTo: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const isTh = useLocale() === 'th';
  const L = isTh
    ? { title: 'ลงเวลาย้อนหลัง (ทั้งสาขา)', desc: (s: string) => `ลงให้พนักงานทุกคนในสาขา “${s}” ตามช่วงวันที่และสถานะที่เลือก`, status: 'สถานะ', from: 'ตั้งแต่วันที่', to: 'ถึงวันที่', lateMin: 'มาสาย (นาที)', overwrite: 'เขียนทับข้อมูลเดิม', overwriteHint: 'ปกติจะเติมเฉพาะวันที่ยังไม่มีข้อมูล', submit: 'ลงเวลาย้อนหลัง', cancel: 'ยกเลิก', done: (w: number, s: number) => `ลงเวลาแล้ว: ${w} รายการ${s ? ` (ข้าม ${s} ที่มีข้อมูลอยู่แล้ว)` : ''}`, none: 'ไม่มีรายการที่ต้องลง (มีข้อมูลครบแล้ว)', fail: 'ลงเวลาไม่สำเร็จ', s_normal: 'ทำงานปกติ', s_absent: 'ขาดงาน', s_leave: 'ลา', s_late: 'มาสาย', s_dayoff: 'วันหยุด' }
    : { title: 'Bulk backfill (whole branch)', desc: (s: string) => `Applies to every employee in “${s}” for the selected range & status.`, status: 'Status', from: 'From', to: 'To', lateMin: 'Late (minutes)', overwrite: 'Overwrite existing', overwriteHint: 'By default only empty days are filled', submit: 'Backfill', cancel: 'Cancel', done: (w: number, s: number) => `Done: ${w} entries${s ? ` (skipped ${s} existing)` : ''}`, none: 'Nothing to fill (all days already have data)', fail: 'Backfill failed', s_normal: 'Worked (normal)', s_absent: 'Absent', s_leave: 'Leave', s_late: 'Late', s_dayoff: 'Day off' };

  const STATUS_OPTS: { value: Status; label: string; tone: string }[] = [
    { value: 'normal', label: L.s_normal, tone: 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-900/20 dark:text-emerald-300' },
    { value: 'absent', label: L.s_absent, tone: 'border-red-300 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-300' },
    { value: 'leave', label: L.s_leave, tone: 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-900/20 dark:text-blue-300' },
    { value: 'late', label: L.s_late, tone: 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-300' },
    { value: 'dayoff', label: L.s_dayoff, tone: 'border-gray-300 bg-gray-50 text-gray-600 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300' },
  ];

  const [status, setStatus] = useState<Status>('normal');
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [lateMin, setLateMin] = useState(30);
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/hr/timesheet/bulk-backfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ store_id: storeId, date_from: from, date_to: to, status, late_min: lateMin, overwrite }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || L.fail);
      const written = (json.data?.written as number) ?? 0;
      const skipped = (json.data?.skipped as number) ?? 0;
      toast({ type: written ? 'success' : 'warning', title: written ? L.done(written, skipped) : L.none });
      onDone();
    } catch (e) {
      toast({ type: 'error', title: e instanceof Error ? e.message : L.fail });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={L.title} size="md">
      <p className="text-sm text-gray-500 dark:text-gray-400">{L.desc(storeName)}</p>

      <div className="mt-4 space-y-4">
        <div>
          <p className="mb-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300">{L.status}</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {STATUS_OPTS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setStatus(o.value)}
                aria-pressed={status === o.value}
                className={cn(
                  'rounded-lg border px-3 py-2 text-sm font-semibold transition-colors',
                  status === o.value ? o.tone : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400'
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col text-xs font-medium text-gray-600 dark:text-gray-400">
            {L.from}
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="control mt-1" />
          </label>
          <label className="flex flex-col text-xs font-medium text-gray-600 dark:text-gray-400">
            {L.to}
            <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="control mt-1" />
          </label>
        </div>

        {status === 'late' && (
          <label className="flex flex-col text-xs font-medium text-gray-600 dark:text-gray-400">
            {L.lateMin}
            <input type="number" min={0} value={lateMin} onChange={(e) => setLateMin(Math.max(0, Number(e.target.value) || 0))} className="control mt-1 w-32" />
          </label>
        )}

        <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800" />
          <span>
            {L.overwrite}
            <span className="block text-xs text-gray-400">{L.overwriteHint}</span>
          </span>
        </label>
      </div>

      <ModalFooter>
        <Button variant="ghost" onClick={onClose} disabled={busy}>{L.cancel}</Button>
        <Button onClick={submit} isLoading={busy} disabled={busy || !storeId}>{L.submit}</Button>
      </ModalFooter>
    </Modal>
  );
}
