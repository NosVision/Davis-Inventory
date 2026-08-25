'use client';

import { useState } from 'react';
import { AlertTriangle, Loader2, Send } from 'lucide-react';
import { Button, toast } from '@/components/ui';
import { formatTimeBangkok } from '@/lib/utils/date';

/**
 * The blocking card shown on /me/checkin when an earlier day was never checked out.
 *
 * Before this, the only trace of a forgotten check-out on the screen the employee actually uses was
 * nothing at all: /me/checkin loads the current business date, so yesterday's dangling punch was
 * invisible there and the page offered a clean check-in button. People read that as "it disappeared"
 * and clocked in again — one account reached three check-ins and no check-outs at all.
 *
 * So the card does not merely warn: it takes the place of the check-in controls until the day is
 * closed. Filing is one tap, because the time is already known — the shift's scheduled end is
 * pre-filled and the only thing left to type is the reason HR will read.
 */

export interface OpenDay {
  business_date: string;
  in_ts: string;
  /** The rostered shift end — the closest thing to "when you actually left" the system knows. */
  suggested_out_ts: string | null;
  shift_label: string | null;
  existing_request: { id: string; status: string } | null;
}

function dmy(date: string): string {
  const [y, m, d] = date.slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : date;
}

/** 'YYYY-MM-DDTHH:mm' for a datetime-local input, in Bangkok wall-clock. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const bkk = new Date(d.getTime() + 7 * 3_600_000);
  return bkk.toISOString().slice(0, 16);
}

/** A Bangkok wall-clock 'YYYY-MM-DDTHH:mm' back to a real instant. */
function fromLocalInput(local: string): string {
  return new Date(`${local}:00+07:00`).toISOString();
}

export function UnclosedDayCard({ days, onFiled }: { days: OpenDay[]; onFiled: () => void }) {
  const [reason, setReason] = useState('');
  const [outAt, setOutAt] = useState(() => {
    const d = days[0];
    // Falls back to the check-in instant rather than "now": a blank field invites a guess, and the
    // employee can always correct it. HR sees the reason either way.
    return toLocalInput(d?.suggested_out_ts ?? d?.in_ts ?? new Date().toISOString());
  });
  const [sending, setSending] = useState(false);

  const day = days[0];
  if (!day) return null;

  const submit = async () => {
    if (!reason.trim()) {
      toast({ type: 'error', title: 'กรุณากรอกเหตุผล' });
      return;
    }
    setSending(true);
    try {
      const res = await fetch('/api/hr/ess/attendance-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_date: day.business_date,
          kind: 'missing_out',
          proposed_type: 'out',
          proposed_ts: fromLocalInput(outAt),
          reason: reason.trim(),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || 'ส่งคำขอไม่สำเร็จ');
      toast({
        type: 'success',
        title: 'ส่งให้ HR แล้ว',
        message: 'ลงเวลาเข้างานวันนี้ได้เลย ไม่ต้องรออนุมัติ',
      });
      setReason('');
      onFiled();
    } catch (e) {
      toast({ type: 'error', title: e instanceof Error ? e.message : 'ส่งคำขอไม่สำเร็จ' });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-3 rounded-2xl border-2 border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-amber-900 dark:text-amber-200">
            {days.length > 1
              ? `มี ${days.length} วันที่ยังไม่ได้เช็คเอาท์`
              : 'มีวันที่ยังไม่ได้เช็คเอาท์'}
          </h2>
          <p className="mt-0.5 text-xs leading-relaxed text-amber-800 dark:text-amber-300">
            ต้องส่งเวลาออกงานของวันที่ค้างก่อน จึงจะลงเวลาเข้างานวันนี้ได้
          </p>
        </div>
      </div>

      {/* The day being closed — and the others still queued behind it. */}
      <div className="rounded-xl bg-white px-3 py-2 text-sm dark:bg-gray-800">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="font-semibold tabular-nums text-gray-900 dark:text-white">
            {dmy(day.business_date)}
          </span>
          <span className="text-xs tabular-nums text-gray-500 dark:text-gray-400">
            เข้างาน {formatTimeBangkok(day.in_ts)}
            {day.shift_label ? ` · กะ ${day.shift_label}` : ''}
          </span>
        </div>
        {days.length > 1 && (
          <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
            อีก {days.length - 1} วันจะขึ้นให้ส่งต่อหลังส่งวันนี้เสร็จ
          </p>
        )}
      </div>

      <label className="block text-xs font-medium text-amber-900 dark:text-amber-200">
        เวลาออกงานจริง
        <input
          type="datetime-local"
          value={outAt}
          onChange={(e) => setOutAt(e.target.value)}
          className="control mt-1 w-full"
        />
        {day.suggested_out_ts && (
          <span className="mt-1 block text-[11px] font-normal text-amber-700/80 dark:text-amber-400/80">
            เติมเวลาเลิกกะตามตารางให้แล้ว — แก้ได้ถ้าออกจริงคนละเวลา
          </span>
        )}
      </label>

      <label className="block text-xs font-medium text-amber-900 dark:text-amber-200">
        เหตุผล <span className="text-red-500">*</span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          placeholder="เช่น ลืมกดเช็คเอาท์ก่อนกลับ"
          className="control mt-1 w-full resize-none"
        />
      </label>

      <Button onClick={submit} disabled={sending} className="w-full">
        {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        ส่งให้ HR
      </Button>
      <p className="text-center text-[11px] text-amber-700/80 dark:text-amber-400/80">
        ส่งแล้วลงเวลาวันนี้ได้ทันที HR ตรวจทีหลัง
      </p>
    </div>
  );
}
