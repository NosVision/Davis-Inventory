// Attendance index (owner ask 2026-07-05): turn an employee's own timesheet into a friendly
// score + plain-language recommendations ("อยู่ในเกณฑ์ดี" / "ควรปรับปรุงเวลาการเข้างาน").
// PURE — no I/O — so the rules are unit-assertable and identical wherever they're shown.
//
// Components (weights chosen so one late day stings but doesn't tank the score, while an
// unexcused absence hits hard — mirrors how the payroll side treats them):
//   punctuality  50%  −12 per late day, −5 per full 30 late minutes (capped −30 for minutes)
//   attendance   35%  −25 per absent day (approved leave never reaches here — absent only)
//   completeness 15%  −10 per incomplete day (missing punch-out etc.)
// Bands: ≥90 excellent · ≥75 good · ≥60 fair · <60 poor.

export interface AttendanceScoreInput {
  scheduledDays: number; // scheduled working days in range (past days only — caller filters)
  absentDays: number;
  lateDays: number;
  lateMinutes: number;
  incompleteDays: number;
  otMinutes: number;
}

export type ScoreBand = 'excellent' | 'good' | 'fair' | 'poor';

export interface Recommendation {
  key: 'perfect' | 'lateSevere' | 'lateMild' | 'absent' | 'incomplete' | 'otHigh';
  params?: Record<string, number>;
}

export interface AttendanceScore {
  overall: number;
  band: ScoreBand;
  components: { punctuality: number; attendance: number; completeness: number };
  recommendations: Recommendation[];
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

// Owner-tunable (hr_policy_settings key 'work_index'); defaults equal the original constants.
export interface ScoreConfig {
  w_punctuality: number;
  w_attendance: number;
  w_completeness: number;
  p_late_day: number;
  p_late_30min: number;
  p_late_cap: number;
  p_absent_day: number;
  p_incomplete_day: number;
  band_excellent: number;
  band_good: number;
  band_fair: number;
}
export const DEFAULT_SCORE_CONFIG: ScoreConfig = {
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
};

export function bandOf(overall: number, cfg: ScoreConfig = DEFAULT_SCORE_CONFIG): ScoreBand {
  if (overall >= cfg.band_excellent) return 'excellent';
  if (overall >= cfg.band_good) return 'good';
  if (overall >= cfg.band_fair) return 'fair';
  return 'poor';
}

/** null เมื่อยังไม่มีวันทำงานในช่วง — ผู้เรียกแสดง "ยังไม่มีข้อมูลพอ" แทนคะแนนหลอกๆ */
export function computeAttendanceScore(
  input: AttendanceScoreInput,
  cfg: ScoreConfig = DEFAULT_SCORE_CONFIG
): AttendanceScore | null {
  if (input.scheduledDays <= 0) return null;

  const punctuality = clamp(
    100 - input.lateDays * cfg.p_late_day - Math.min(cfg.p_late_cap, Math.floor(input.lateMinutes / 30) * cfg.p_late_30min)
  );
  const attendance = clamp(100 - input.absentDays * cfg.p_absent_day);
  const completeness = clamp(100 - input.incompleteDays * cfg.p_incomplete_day);
  const wSum = cfg.w_punctuality + cfg.w_attendance + cfg.w_completeness || 100;
  const overall = clamp(
    (punctuality * cfg.w_punctuality + attendance * cfg.w_attendance + completeness * cfg.w_completeness) / wSum
  );

  const recommendations: Recommendation[] = [];
  if (input.absentDays > 0) {
    recommendations.push({ key: 'absent', params: { n: input.absentDays } });
  }
  if (input.lateDays >= 3 || input.lateMinutes >= 60) {
    recommendations.push({ key: 'lateSevere', params: { n: input.lateDays, min: input.lateMinutes } });
  } else if (input.lateDays > 0) {
    recommendations.push({ key: 'lateMild', params: { n: input.lateDays } });
  }
  if (input.incompleteDays > 0) {
    recommendations.push({ key: 'incomplete', params: { n: input.incompleteDays } });
  }
  if (recommendations.length === 0) {
    recommendations.push({ key: 'perfect' });
  }
  if (input.otMinutes >= 600) {
    recommendations.push({ key: 'otHigh', params: { hours: Math.round(input.otMinutes / 60) } });
  }

  return { overall, band: bandOf(overall, cfg), components: { punctuality, attendance, completeness }, recommendations };
}
