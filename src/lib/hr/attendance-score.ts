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

export function bandOf(overall: number): ScoreBand {
  if (overall >= 90) return 'excellent';
  if (overall >= 75) return 'good';
  if (overall >= 60) return 'fair';
  return 'poor';
}

/** null เมื่อยังไม่มีวันทำงานในช่วง — ผู้เรียกแสดง "ยังไม่มีข้อมูลพอ" แทนคะแนนหลอกๆ */
export function computeAttendanceScore(input: AttendanceScoreInput): AttendanceScore | null {
  if (input.scheduledDays <= 0) return null;

  const punctuality = clamp(
    100 - input.lateDays * 12 - Math.min(30, Math.floor(input.lateMinutes / 30) * 5)
  );
  const attendance = clamp(100 - input.absentDays * 25);
  const completeness = clamp(100 - input.incompleteDays * 10);
  const overall = clamp(punctuality * 0.5 + attendance * 0.35 + completeness * 0.15);

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

  return { overall, band: bandOf(overall), components: { punctuality, attendance, completeness }, recommendations };
}
