'use client';

import { useState } from 'react';
import { AlertTriangle, Loader2, Send } from 'lucide-react';
import { Button, toast } from '@/components/ui';
import { formatTimeBangkok } from '@/lib/utils/date';
import { formatDmy } from '@/lib/utils/format';
import {
  closingInstantAfter,
  isSpanTooLong,
  BUSINESS_DAY_CUTOFF_HOUR,
  CLOSING_PUNCH_TAIL_HOURS,
  MAX_SHIFT_SPAN_HOURS,
} from '@/lib/hr/attendance-window';

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

/**
 * The Bangkok wall-clock 'HH:mm' of an instant — what `<input type="time">` wants.
 *
 * Arithmetic rather than Intl: an `hour12: false` formatter reports midnight as "24:00" under some
 * locale data, which a time input rejects outright.
 */
function toTimeInput(iso: string): string {
  return new Date(new Date(iso).getTime() + 7 * 3_600_000).toISOString().slice(11, 16);
}

/** The Bangkok calendar date an instant falls on — same arithmetic, same reason. */
function toBangkokDate(iso: string): string {
  return new Date(new Date(iso).getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
}

/** "16 ชม. 30 น." — the span the employee is about to claim, so a wrong time is obvious. */
function spanLabel(fromIso: string, toIso: string): string {
  const min = Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60_000);
  if (!Number.isFinite(min) || min <= 0) return '—';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} ชม. ${m} น.` : `${h} ชม.`;
}

export function UnclosedDayCard({ days, onFiled }: { days: OpenDay[]; onFiled: () => void }) {
  const day = days[0];
  if (!day) return null;
  // Keyed on the day BEING CLOSED, not mounted once for the queue. The form's initial time comes
  // from `days[0]`, and a useState initializer runs only on mount: without this key the card kept
  // the first day's time as the queue advanced, and three days filed back to back all proposed the
  // FIRST day's timestamp — writing 20/07 19:00 as the check-out of 24/08 and 25/08 (May, 26/08).
  // Remounting per day also clears the reason, which belongs to one day, not to the queue.
  return (
    <DayCloseForm
      key={day.business_date}
      day={day}
      remaining={days.length - 1}
      onFiled={onFiled}
    />
  );
}

function DayCloseForm({
  day,
  remaining,
  onFiled,
}: {
  day: OpenDay;
  remaining: number;
  onFiled: () => void;
}) {
  const [reason, setReason] = useState('');
  // Time only. The DATE is not the employee's to choose — it is the day being closed, stated above
  // — and a full datetime picker made it theirs to get wrong: on a Thai phone it rendered as
  // "20 Jul BE 2569 at 19:00", too wide for the screen and reading like a field they had to type.
  const [outTime, setOutTime] = useState(() =>
    toTimeInput(day.suggested_out_ts ?? day.in_ts)
  );
  const [sending, setSending] = useState(false);

  // Which INSTANT the typed time means. A night shift ends on the next calendar day — after
  // midnight (02:00) and sometimes after sunrise (10:30) — so a time that would land before the
  // check-in is read as the next morning, not as an impossible earlier one. The resolved date is
  // then shown below the field: the employee confirms it instead of the form deciding silently.
  const proposedTs = closingInstantAfter(day.business_date, outTime, day.in_ts);
  const spillsToNextDay = toBangkokDate(proposedTs) !== day.business_date;
  const outHour = Number(outTime.slice(0, 2));
  // Beyond this the punch stops belonging to that shift at all (server: OFF_BUSINESS_DATE_OUT).
  const pastWindow =
    spillsToNextDay && outHour >= BUSINESS_DAY_CUTOFF_HOUR + CLOSING_PUNCH_TAIL_HOURS;
  // A time typed before a MORNING shift's own check-in resolves to the next day and would claim
  // most of a day's work. Flag it here rather than let payroll pay it.
  const tooLong = !pastWindow && isSpanTooLong(day.in_ts, proposedTs);

  const submit = async () => {
    if (!reason.trim()) {
      toast({ type: 'error', title: 'กรุณากรอกเหตุผล' });
      return;
    }
    if (pastWindow) {
      toast({
        type: 'error',
        title: 'เวลาออกงานเลยกะของวันนั้นไปแล้ว',
        message: `กะของวันที่ ${formatDmy(day.business_date)} ออกงานได้ถึง 12:00 ของวันถัดไป — ถ้าออกช้ากว่านั้นจริง แจ้ง HR ให้แก้ให้`,
      });
      return;
    }
    if (new Date(proposedTs).getTime() <= new Date(day.in_ts).getTime()) {
      toast({
        type: 'error',
        title: 'เวลาออกงานต้องอยู่หลังเวลาเข้างาน',
        message: `วันนั้นเข้างาน ${formatTimeBangkok(day.in_ts)}`,
      });
      return;
    }
    if (tooLong) {
      toast({
        type: 'error',
        title: `ช่วงเวลาทำงานยาวเกิน ${MAX_SHIFT_SPAN_HOURS} ชั่วโมง`,
        message: `วันนั้นเข้างาน ${formatTimeBangkok(day.in_ts)} — ตรวจเวลาที่กรอกอีกครั้ง`,
      });
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
          proposed_ts: proposedTs,
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
            {remaining > 0
              ? `มี ${remaining + 1} วันที่ยังไม่ได้เช็คเอาท์`
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
            {formatDmy(day.business_date)}
          </span>
          <span className="text-xs tabular-nums text-gray-500 dark:text-gray-400">
            เข้างาน {formatTimeBangkok(day.in_ts)}
            {day.shift_label ? ` · กะ ${day.shift_label}` : ''}
          </span>
        </div>
        {remaining > 0 && (
          <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
            อีก {remaining} วันจะขึ้นให้ส่งต่อหลังส่งวันนี้เสร็จ
          </p>
        )}
      </div>

      <div>
        <label
          htmlFor="unclosed-out-time"
          className="block text-xs font-medium text-amber-900 dark:text-amber-200"
        >
          ออกงานจริงกี่โมง — กะของวันที่ {formatDmy(day.business_date)}
        </label>
        {/* `w-auto` on purpose: a time field sized to its own content stays inside the screen on a
            phone, where a full-width one stretched past the edge. */}
        <input
          id="unclosed-out-time"
          type="time"
          value={outTime}
          onChange={(e) => setOutTime(e.target.value)}
          className="control mt-1 w-auto max-w-full text-base tabular-nums"
        />
        {/* What the typed time actually resolves to. A night shift's out lands on the next calendar
            day, and "ออก 10:30" with no date beside it is exactly what made this look broken. */}
        <p
          className={`mt-1 text-[11px] tabular-nums ${
            pastWindow || tooLong
              ? 'font-medium text-red-600 dark:text-red-400'
              : 'text-amber-800 dark:text-amber-300'
          }`}
        >
          {pastWindow
            ? `ออกงาน ${formatDmy(toBangkokDate(proposedTs))} ${outTime} — เลยกะของวันนั้นแล้ว (ได้ถึง 12:00 ของวันถัดไป)`
            : `ออกงาน ${formatDmy(toBangkokDate(proposedTs))} ${outTime}${spillsToNextDay ? ' (วันถัดไป)' : ''} · รวม ${spanLabel(day.in_ts, proposedTs)}${tooLong ? ' — ยาวผิดปกติ ตรวจอีกครั้ง' : ''}`}
        </p>
        <p className="mt-0.5 text-[11px] text-amber-700/80 dark:text-amber-400/80">
          {day.suggested_out_ts
            ? 'เติมเวลาเลิกกะตามตารางให้แล้ว — แก้ได้ถ้าออกจริงคนละเวลา'
            : 'ใส่เวลาที่ออกงานจริงของวันนั้น'}
        </p>
      </div>

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
