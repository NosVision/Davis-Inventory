import type { SupabaseClient } from '@supabase/supabase-js';
import { nowBangkok } from '@/lib/utils/date';

// Notify a little before the shift starts and a while after it ends, so edge-of-shift alerts still land.
const PRE_SHIFT_MIN = 30;
const POST_SHIFT_MIN = 60;

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// 'HH:MM' | 'HH:MM:SS' → minutes since midnight.
function toMinutes(time: string): number {
  const [h, m] = time.split(':').map((n) => parseInt(n, 10));
  return (h || 0) * 60 + (m || 0);
}

interface SchedRow {
  work_date: string;
  is_day_off: boolean | null;
  shift_template_id: string | null;
}
interface TplRow {
  id: string;
  start_time: string | null;
  end_time: string | null;
}

/**
 * Is `userId` within their working hours right now (Bangkok)? Used to gate web push so people are not
 * pinged on a day off or in the middle of the night. Semantics (all Bangkok wall-clock):
 *   • Clocked in — last attendance punch today/yesterday is anything but 'out' → yes.
 *   • Otherwise within a scheduled shift window (± buffer), overnight shifts included → yes.
 *   • Has schedule rows for today/yesterday but none active now (day off / other shift) → no.
 *   • No schedule at all (person is not on the shift system) → yes (fail-open; never fully silence).
 * Any error → yes: the gate must never be the reason a notification is dropped.
 */
export async function isWithinWorkHours(service: SupabaseClient, userId: string): Promise<boolean> {
  try {
    const now = nowBangkok();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const today = ymd(now);
    const yest = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));

    // 1) Currently clocked in? Last punch on today/yesterday that is not a clock-out means "at work"
    //    (break_start/break_end still count — they are on shift, just on a break).
    const { data: punches } = await service
      .from('hr_attendance')
      .select('type')
      .eq('user_id', userId)
      .in('business_date', [today, yest])
      .order('ts', { ascending: false })
      .limit(1);
    const last = (punches ?? [])[0] as { type?: string } | undefined;
    if (last?.type && last.type !== 'out') return true;

    // 2) Scheduled shift window (today, plus yesterday for overnight shifts that spill past midnight).
    const { data: schedData } = await service
      .from('hr_schedule')
      .select('work_date, is_day_off, shift_template_id')
      .eq('user_id', userId)
      .in('work_date', [today, yest]);
    const rows = (schedData ?? []) as SchedRow[];
    if (rows.length === 0) return true; // not on the shift system → don't silence them

    const tplIds = [...new Set(rows.map((r) => r.shift_template_id).filter((v): v is string => !!v))];
    const tplById = new Map<string, TplRow>();
    if (tplIds.length > 0) {
      const { data: tpls } = await service
        .from('hr_shift_templates')
        .select('id, start_time, end_time')
        .in('id', tplIds);
      for (const t of (tpls ?? []) as TplRow[]) tplById.set(t.id, t);
    }

    for (const r of rows) {
      if (r.is_day_off) continue;
      const tpl = r.shift_template_id ? tplById.get(r.shift_template_id) : undefined;
      if (!tpl?.start_time || !tpl?.end_time) continue;
      const startMin = toMinutes(tpl.start_time);
      const endMin = toMinutes(tpl.end_time);
      const overnight = endMin <= startMin;
      const winStart = startMin - PRE_SHIFT_MIN;
      const winEnd = endMin + POST_SHIFT_MIN;

      if (r.work_date === today) {
        if (overnight) {
          if (nowMin >= winStart) return true; // evening portion, before midnight
        } else if (nowMin >= winStart && nowMin <= winEnd) {
          return true;
        }
      } else if (r.work_date === yest && overnight) {
        if (nowMin <= winEnd) return true; // small-hours portion, after midnight
      }
    }
    return false; // scheduled today/yesterday, but not on shift right now
  } catch {
    return true;
  }
}
