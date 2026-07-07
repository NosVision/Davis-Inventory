import type { SupabaseClient } from '@supabase/supabase-js';

// Group-wide policy knobs (owner requirement 2026-07-05): every value here used to be a
// hardcoded constant. The DEFAULTS below EQUAL those historical constants — with no rows in
// hr_policy_settings the system behaves exactly as before (the offline asserts pin this).
// Money-per-company parameters (SSO, ÷divisor, OT) live on hr_companies, not here.

export interface LateTierPolicy {
  tier1_satang: number; // 1..tier2_from-1 late minutes → flat fine
  tier2_from_min: number;
  tier2_satang: number; // tier2_from..tier3_from-1
  tier3_from_min: number;
  tier3_satang_per_hour: number; // ≥ tier3_from: per FULL hour
}

export interface WorkIndexPolicy {
  w_punctuality: number; // weights — must sum to 100
  w_attendance: number;
  w_completeness: number;
  p_late_day: number; // penalty per late day
  p_late_30min: number; // penalty per full 30 late minutes (capped p_late_cap)
  p_late_cap: number;
  p_absent_day: number;
  p_incomplete_day: number;
  band_excellent: number;
  band_good: number;
  band_fair: number;
}

export interface HrPolicies {
  late_tiers: LateTierPolicy;
  probation_days: number;
  sc_leave_divisor: number; // a leave day docks allocated/THIS
  warning_carry_enabled: boolean; // 200% warning: carry the overflow into next month's SC
  work_index: WorkIndexPolicy;
  /** ⑤ payslip-ready push: 'manual' = HR presses ประกาศ; 'immediate' = fire on finalize */
  payslip_announce_mode: 'manual' | 'immediate';
  /** Mid-period hire/leave proration basis for full_monthly staff:
   *  'calendar' = employed calendar days ÷30; 'scheduled' = scheduled work days in the window. */
  prorate_basis: 'calendar' | 'scheduled';
}

export const POLICY_DEFAULTS: HrPolicies = {
  late_tiers: {
    tier1_satang: 5000, // ฿50 from the very first minute (real June-2026 sheet)
    tier2_from_min: 31,
    tier2_satang: 10000, // ฿100
    tier3_from_min: 60,
    tier3_satang_per_hour: 25000, // ฿250 per full hour
  },
  probation_days: 119,
  sc_leave_divisor: 30,
  warning_carry_enabled: true,
  work_index: {
    w_punctuality: 50,
    w_attendance: 35,
    w_completeness: 15,
    p_late_day: 12,
    p_late_30min: 5,
    p_late_cap: 30,
    p_absent_day: 25,
    p_incomplete_day: 10,
    band_excellent: 90,
    band_good: 75,
    band_fair: 60,
  },
  payslip_announce_mode: 'manual', // เมย์คุมจังหวะเองช่วงเปลี่ยนผ่าน (owner-agreed default)
  prorate_basis: 'calendar', // owner-chosen 2026-07-07: employed calendar days ÷30
};

const num = (v: unknown, fallback: number, min: number, max: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};

/** Merge a stored jsonb value over the defaults, clamping every field to a sane range. */
export function mergePolicies(rows: { key: string; value: unknown }[]): HrPolicies {
  const byKey = new Map(rows.map((r) => [r.key, r.value as Record<string, unknown>]));
  const d = POLICY_DEFAULTS;

  const lt = (byKey.get('late_tiers') ?? {}) as Record<string, unknown>;
  const wi = (byKey.get('work_index') ?? {}) as Record<string, unknown>;
  const scalar = (key: string) => byKey.get(key) as Record<string, unknown> | undefined;

  return {
    late_tiers: {
      tier1_satang: num(lt.tier1_satang, d.late_tiers.tier1_satang, 0, 10_000_000),
      tier2_from_min: num(lt.tier2_from_min, d.late_tiers.tier2_from_min, 1, 1440),
      tier2_satang: num(lt.tier2_satang, d.late_tiers.tier2_satang, 0, 10_000_000),
      tier3_from_min: num(lt.tier3_from_min, d.late_tiers.tier3_from_min, 1, 1440),
      tier3_satang_per_hour: num(lt.tier3_satang_per_hour, d.late_tiers.tier3_satang_per_hour, 0, 10_000_000),
    },
    probation_days: num(scalar('probation_days')?.days, d.probation_days, 0, 730),
    sc_leave_divisor: num(scalar('sc_leave_divisor')?.divisor, d.sc_leave_divisor, 1, 31),
    warning_carry_enabled: (scalar('warning_carry')?.enabled ?? d.warning_carry_enabled) === true,
    payslip_announce_mode:
      scalar('payslip_announce')?.mode === 'immediate' ? 'immediate' : d.payslip_announce_mode,
    prorate_basis:
      scalar('prorate_basis')?.mode === 'scheduled' ? 'scheduled' : d.prorate_basis,
    work_index: {
      w_punctuality: num(wi.w_punctuality, d.work_index.w_punctuality, 0, 100),
      w_attendance: num(wi.w_attendance, d.work_index.w_attendance, 0, 100),
      w_completeness: num(wi.w_completeness, d.work_index.w_completeness, 0, 100),
      p_late_day: num(wi.p_late_day, d.work_index.p_late_day, 0, 100),
      p_late_30min: num(wi.p_late_30min, d.work_index.p_late_30min, 0, 100),
      p_late_cap: num(wi.p_late_cap, d.work_index.p_late_cap, 0, 100),
      p_absent_day: num(wi.p_absent_day, d.work_index.p_absent_day, 0, 100),
      p_incomplete_day: num(wi.p_incomplete_day, d.work_index.p_incomplete_day, 0, 100),
      band_excellent: num(wi.band_excellent, d.work_index.band_excellent, 1, 100),
      band_good: num(wi.band_good, d.work_index.band_good, 1, 100),
      band_fair: num(wi.band_fair, d.work_index.band_fair, 1, 100),
    },
  };
}

/** Load + merge all policy rows. Fail-open to DEFAULTS: a read error must never block payroll. */
export async function getHrPolicies(service: SupabaseClient): Promise<HrPolicies> {
  const { data, error } = await service.from('hr_policy_settings').select('key, value');
  if (error || !data) return POLICY_DEFAULTS;
  return mergePolicies(data as { key: string; value: unknown }[]);
}
