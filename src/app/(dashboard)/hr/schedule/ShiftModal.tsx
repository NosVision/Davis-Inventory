'use client';

import { useState } from 'react';
import { Loader2, Trash2, AlertTriangle } from 'lucide-react';
import { Button, Modal, ModalFooter, toast } from '@/components/ui';

interface ShiftTemplate {
  id: string;
  label: string;
  start_time: string;
  end_time: string;
  color: string | null;
}
interface Props {
  template: ShiftTemplate;
  isTh: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

const hhmm = (t: string) => t.slice(0, 5);

/**
 * The native <input type="time"> renders as a 12-hour AM/PM picker under an en-US locale, so
 * picking "10:00 PM" when you meant 10:00 stores 22:00 — and late detection silently reads 0
 * minutes because the punch lands BEFORE the shift start (time-engine clamps at 0).
 * That is exactly how the "10:00" shift ended up starting at 22:00.
 *
 * When the shift NAME leads with a time ("10:00", "10:00-19:00"), compare it against the picked
 * start and surface the gap. Returns null when the name isn't time-shaped or already agrees.
 */
export function labelTimeMismatch(label: string, start: string): string | null {
  const m = /^\s*(\d{1,2}):(\d{2})/.exec(label);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  const fromLabel = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  return fromLabel === start.slice(0, 5) ? null : fromLabel;
}

/** 22:00 → "10:00 PM" — spells out what the 12-hour picker was actually set to. */
export function to12h(t: string): string {
  const [h, m] = t.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return t;
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

// Edit / delete one shift template (§C UX). Delete cascades: it first warns how many roster
// assignments use the shift (they get removed too), then confirms.
export default function ShiftModal({ template, isTh, onClose, onSaved }: Props) {
  const L = isTh
    ? { title: 'แก้ไขกะ', name: 'ชื่อกะ', start: 'เริ่ม', end: 'เลิก', color: 'สี', save: 'บันทึก', del: 'ลบกะนี้',
        delTitle: 'ยืนยันลบกะ', delWarn: (n: number) => `กะนี้ถูกใช้จัดตารางพนักงานอยู่ ${n} รายการ — ลบแล้วรายการเหล่านั้นจะถูกลบไปด้วย`, delWarnNone: 'ยังไม่มีพนักงานถูกจัดกะนี้ — ลบได้เลย', confirmDel: 'ลบกะและรายการที่เกี่ยวข้อง', cancel: 'ยกเลิก', saved: 'บันทึกแล้ว', deleted: (n: number) => `ลบกะแล้ว (ลบการจัดตาราง ${n} รายการ)`, failed: 'ทำรายการไม่สำเร็จ', needName: 'กรอกชื่อกะ',
        actualTimes: 'เวลาที่ระบบจะใช้คำนวณสาย',
        mismatch: (fromLabel: string, picked: string) => `ชื่อกะขึ้นต้นด้วย ${fromLabel} แต่เวลาเริ่มที่เลือกคือ ${picked} (${to12h(picked)}) — ระบบคำนวณสายจาก ${picked} ไม่ใช่ ${fromLabel} ถ้าตั้งใจให้เข้างาน ${fromLabel} ต้องแก้ช่อง "เริ่ม"` }
    : { title: 'Edit shift', name: 'Shift name', start: 'Start', end: 'End', color: 'Color', save: 'Save', del: 'Delete shift',
        delTitle: 'Confirm delete', delWarn: (n: number) => `This shift is used in ${n} roster assignment(s) — deleting it removes those too`, delWarnNone: 'No employees are assigned this shift — safe to delete', confirmDel: 'Delete shift + its assignments', cancel: 'Cancel', saved: 'Saved', deleted: (n: number) => `Shift deleted (${n} assignment(s) removed)`, failed: 'Action failed', needName: 'Enter a shift name',
        actualTimes: 'Times used for late detection',
        mismatch: (fromLabel: string, picked: string) => `The shift name starts with ${fromLabel} but the picked start is ${picked} (${to12h(picked)}) — lateness is measured from ${picked}, not ${fromLabel}. Fix the "Start" field if you meant ${fromLabel}.` };

  const [label, setLabel] = useState(template.label);
  const [start, setStart] = useState(hhmm(template.start_time));
  const [end, setEnd] = useState(hhmm(template.end_time));
  const [color, setColor] = useState(template.color || '#6366f1');
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [usage, setUsage] = useState<number | null>(null);

  const labelMismatch = labelTimeMismatch(label, start);

  const save = async () => {
    if (!label.trim()) { toast({ type: 'warning', title: L.needName }); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/hr/shift-templates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: template.id, label: label.trim(), start_time: start, end_time: end, color }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) { toast({ type: 'error', title: L.failed, message: j?.error }); return; }
      toast({ type: 'success', title: L.saved });
      await onSaved();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  // Fetch how many assignments use this shift, then show the delete confirmation.
  const askDelete = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/hr/shift-templates?usage=${template.id}`);
      const j = (await res.json().catch(() => ({}))) as { data?: { count: number } };
      setUsage(j.data?.count ?? 0);
      setConfirmingDelete(true);
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/hr/shift-templates?id=${template.id}`, { method: 'DELETE' });
      const j = (await res.json().catch(() => ({}))) as { error?: string; data?: { removed_assignments: number } };
      if (!res.ok) { toast({ type: 'error', title: L.failed, message: j?.error }); return; }
      toast({ type: 'success', title: L.deleted(j.data?.removed_assignments ?? 0) });
      await onSaved();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={confirmingDelete ? L.delTitle : L.title} size="sm">
      {confirmingDelete ? (
        <div className="space-y-3">
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800/60 dark:bg-amber-900/20 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>{usage && usage > 0 ? L.delWarn(usage) : L.delWarnNone}</span>
          </div>
          <ModalFooter className="px-0 pb-0">
            <Button variant="ghost" onClick={() => setConfirmingDelete(false)} disabled={busy}>{L.cancel}</Button>
            <Button variant="outline" onClick={doDelete} isLoading={busy} className="border-red-300 text-red-600 hover:bg-red-50" icon={<Trash2 className="h-4 w-4" />}>
              {L.confirmDel}
            </Button>
          </ModalFooter>
        </div>
      ) : (
        <div className="space-y-3">
          <label className="flex flex-col text-xs font-medium text-gray-600 dark:text-gray-400">
            {L.name}
            <input value={label} onChange={(e) => setLabel(e.target.value)} className="control mt-1" />
          </label>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col text-xs font-medium text-gray-600 dark:text-gray-400">
              {L.start}
              <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="control mt-1" />
            </label>
            <label className="flex flex-col text-xs font-medium text-gray-600 dark:text-gray-400">
              {L.end}
              <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="control mt-1" />
            </label>
            <label className="flex flex-col text-xs font-medium text-gray-600 dark:text-gray-400">
              {L.color}
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="mt-1 h-9 w-12 rounded border border-gray-300 dark:border-gray-600" />
            </label>
          </div>

          {/* Always echo the picked times in 24h — the picker itself may be showing AM/PM. */}
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {L.actualTimes}: <span className="font-medium tabular-nums text-gray-700 dark:text-gray-200">{start}–{end}</span>
            <span className="ml-1 text-gray-400 dark:text-gray-500">({to12h(start)} – {to12h(end)})</span>
          </p>

          {labelMismatch && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800/60 dark:bg-amber-900/20 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>{L.mismatch(labelMismatch, start)}</span>
            </div>
          )}
          <ModalFooter className="px-0 pb-0">
            <Button variant="ghost" onClick={askDelete} disabled={busy} className="mr-auto text-red-600 hover:bg-red-50" icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}>
              {L.del}
            </Button>
            <Button variant="ghost" onClick={onClose} disabled={busy}>{L.cancel}</Button>
            <Button onClick={save} isLoading={busy}>{L.save}</Button>
          </ModalFooter>
        </div>
      )}
    </Modal>
  );
}
