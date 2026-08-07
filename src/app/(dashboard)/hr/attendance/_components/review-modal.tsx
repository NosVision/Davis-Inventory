'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { Modal, ModalFooter, Button, toast } from '@/components/ui';
import { cn } from '@/lib/utils/cn';
import { formatTimeBangkok } from '@/lib/utils/date';
import { useLeaveTypes } from '@/hooks/use-leave-types';
import { EmployeeName } from '@/components/hr/employee-name';

type Action = 'approve' | 'reject' | 'set_time' | 'absent' | 'leave';

export interface ReviewRow {
  id: string;
  user_id: string;
  employee_name: string | null;
  employee_nickname: string | null;
  type: string;
  ts: string;
  distance_m: number | null;
  is_vpn_suspect: boolean;
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Resolve a pending out-of-geofence / suspect punch (owner 2026-07-08). Beyond approve/reject, HR can
// set the real time or mark the day absent/leave — all recompute the timesheet server-side.
export function AttendanceReviewModal({ row, onClose, onDone }: { row: ReviewRow | null; onClose: () => void; onDone: () => void }) {
  const isTh = useLocale() === 'th';
  const L = isTh
    ? { title: 'ตรวจสอบการลงเวลา', pick: 'เลือกผลลัพธ์', realTime: 'เวลาจริง', note: 'หมายเหตุ (ไม่บังคับ)', leaveType: 'ประเภทการลา', pickType: 'เลือกประเภทการลาก่อนบันทึก', save: 'บันทึก', cancel: 'ยกเลิก', saved: 'บันทึกผลแล้ว', fail: 'บันทึกไม่สำเร็จ', suspect: 'ตำแหน่ง/เครือข่ายน่าสงสัย', outBy: (m: number) => `นอกพื้นที่ ~${m} ม.`,
        type: { in: 'เข้างาน', out: 'ออกงาน', break_start: 'เริ่มพัก', break_end: 'เลิกพัก' } as Record<string, string>,
        a_approve: 'อนุมัติ (นับตามที่ลง)', a_reject: 'ปฏิเสธ (ไม่นับเวลานี้)', a_set_time: 'แก้เป็นเวลาจริง', a_absent: 'บันทึกเป็นขาดงาน', a_leave: 'บันทึกเป็นวันลา',
        h_approve: 'เก็บเวลานี้ไว้ตามปกติ', h_reject: 'ตัดเวลานี้ออกจากการคำนวณ', h_set_time: 'แก้เวลาให้ถูก แล้วคำนวณใหม่', h_absent: 'ทำงาน 0 ชม. (ขาด) วันนี้', h_leave: 'สร้างใบลาตามประเภทที่เลือก (จ่ายตามกติกาของประเภทนั้น)' }
    : { title: 'Review punch', pick: 'Choose outcome', realTime: 'Actual time', note: 'Note (optional)', leaveType: 'Leave type', pickType: 'Pick a leave type before saving', save: 'Save', cancel: 'Cancel', saved: 'Saved', fail: 'Failed', suspect: 'Suspicious location/network', outBy: (m: number) => `Out of range ~${m} m`,
        type: { in: 'Check in', out: 'Check out', break_start: 'Start break', break_end: 'End break' } as Record<string, string>,
        a_approve: 'Approve (count as-is)', a_reject: 'Reject (don’t count)', a_set_time: 'Set real time', a_absent: 'Mark absent', a_leave: 'Mark on leave',
        h_approve: 'Keep this punch as normal', h_reject: 'Exclude this punch from hours', h_set_time: 'Correct the time, then recompute', h_absent: 'Worked 0h (absent) today', h_leave: 'Create a typed leave (paid per its rules)' };

  const OPTS: { value: Action; label: string; hint: string; tone: string }[] = [
    { value: 'approve', label: L.a_approve, hint: L.h_approve, tone: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-900/20 dark:text-emerald-300' },
    { value: 'reject', label: L.a_reject, hint: L.h_reject, tone: 'border-red-300 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-300' },
    { value: 'set_time', label: L.a_set_time, hint: L.h_set_time, tone: 'border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-900/60 dark:bg-blue-900/20 dark:text-blue-300' },
    { value: 'absent', label: L.a_absent, hint: L.h_absent, tone: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-300' },
    { value: 'leave', label: L.a_leave, hint: L.h_leave, tone: 'border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-900/60 dark:bg-violet-900/20 dark:text-violet-300' },
  ];

  const [action, setAction] = useState<Action>('approve');
  const [tsLocal, setTsLocal] = useState('');
  const [note, setNote] = useState('');
  const [leaveTypeId, setLeaveTypeId] = useState('');
  const [busy, setBusy] = useState(false);

  // Leave types for THIS employee's company (resolved by user_id) — the same source everywhere.
  const { leaveTypes } = useLeaveTypes(null, row?.user_id ?? null);
  useEffect(() => {
    setLeaveTypeId((prev) => prev || leaveTypes[0]?.id || '');
  }, [leaveTypes]);

  useEffect(() => {
    if (row) { setAction('approve'); setNote(''); setTsLocal(toLocalInput(row.ts)); }
  }, [row]);

  if (!row) return null;

  const submit = async () => {
    if (action === 'leave' && !leaveTypeId) { toast({ type: 'warning', title: L.pickType }); return; }
    setBusy(true);
    try {
      const payload: Record<string, unknown> = { action, note: note.trim() || undefined };
      if (action === 'set_time') payload.ts = new Date(tsLocal).toISOString();
      if (action === 'leave') payload.leave_type_id = leaveTypeId;
      const res = await fetch(`/api/hr/attendance/${row.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || L.fail);
      toast({ type: 'success', title: L.saved, message: typeof json.warning === 'string' ? json.warning : undefined });
      onDone();
    } catch (e) {
      toast({ type: 'error', title: e instanceof Error ? e.message : L.fail });
    } finally {
      setBusy(false);
    }
  };

  const reason = row.is_vpn_suspect ? L.suspect : row.distance_m != null ? L.outBy(Math.round(row.distance_m)) : '';

  return (
    <Modal isOpen onClose={onClose} title={L.title} size="md">
      <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm dark:bg-gray-800/60">
        <EmployeeName
          name={row.employee_name || '—'}
          nickname={row.employee_nickname}
          className="font-semibold text-gray-900 dark:text-white"
        />
        <span className="text-gray-500 dark:text-gray-400"> · {L.type[row.type] ?? row.type} · {formatTimeBangkok(row.ts)}</span>
        {reason && <span className="ml-1 text-amber-600 dark:text-amber-400">· {reason}</span>}
      </div>

      <p className="mt-4 mb-2 text-xs font-semibold text-gray-600 dark:text-gray-300">{L.pick}</p>
      <div className="space-y-2">
        {OPTS.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => setAction(o.value)}
            aria-pressed={action === o.value}
            className={cn(
              'flex w-full flex-col rounded-lg border px-3 py-2 text-left transition-colors',
              action === o.value ? o.tone : 'border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700/50'
            )}
          >
            <span className="text-sm font-semibold">{o.label}</span>
            <span className={cn('text-xs', action === o.value ? 'opacity-80' : 'text-gray-400')}>{o.hint}</span>
          </button>
        ))}
      </div>

      {action === 'set_time' && (
        <label className="mt-3 block text-xs font-medium text-gray-600 dark:text-gray-400">
          {L.realTime}
          <input type="datetime-local" value={tsLocal} onChange={(e) => setTsLocal(e.target.value)} className="control mt-1 w-full" />
        </label>
      )}

      {action === 'leave' && (
        <label className="mt-3 block text-xs font-medium text-gray-600 dark:text-gray-400">
          {L.leaveType}
          <select value={leaveTypeId} onChange={(e) => setLeaveTypeId(e.target.value)} className="control mt-1 w-full">
            {leaveTypes.length === 0 && <option value="">—</option>}
            {leaveTypes.map((lt) => (
              <option key={lt.id} value={lt.id}>{isTh ? lt.name_th : lt.name_en}</option>
            ))}
          </select>
        </label>
      )}

      <label className="mt-3 block text-xs font-medium text-gray-600 dark:text-gray-400">
        {L.note}
        <input value={note} onChange={(e) => setNote(e.target.value)} className="control mt-1 w-full" />
      </label>

      <ModalFooter>
        <Button variant="ghost" onClick={onClose} disabled={busy}>{L.cancel}</Button>
        <Button onClick={submit} isLoading={busy} disabled={busy || (action === 'set_time' && !tsLocal)}>{L.save}</Button>
      </ModalFooter>
    </Modal>
  );
}
