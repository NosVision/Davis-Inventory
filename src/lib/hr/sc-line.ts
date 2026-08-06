/**
 * Service-Charge / tip deduction lines carry a `label` that was WRITTEN IN ENGLISH at recompute
 * time ("Warning: deduct_50", "Absent (7d)", "Leave: personal (2d)") and stored in the row — so a
 * Thai payslip rendered them verbatim and came out bilingual. Rather than rewrite history (the
 * stored text is what the pool was announced with), the display side re-derives the line's MEANING
 * from `source_type` + that label and localizes it at render time.
 *
 * Pure and framework-free so both the payslip view and the SC console can share it; the actual
 * wording lives in the message catalog (see `useScLineLabel`).
 */

export interface ScLineRef {
  source_type: string;
  label: string | null;
}

export type ParsedScLine =
  /** an issued warning — `level` is an hr_warnings level (verbal | deduct_50 | …) */
  | { kind: 'warning'; level: string | null }
  /** unauthorised absence over the pool month */
  | { kind: 'absent'; days: number | null }
  /** approved leave that docks SC — `code` is an hr_leave_types code */
  | { kind: 'leave'; code: string | null; days: number | null }
  /** balance carried in from the previous month */
  | { kind: 'carry'; family: 'warning' | 'eval' | 'stock_penalty' }
  /** anything already human-authored (manual/ad-hoc/eval/stock penalty lines) */
  | { kind: 'raw'; text: string };

const DAYS = /\((\d+(?:\.\d+)?)\s*d\)/i;
const WARNING_LEVEL = /^warning:\s*(\S+)/i;
const LEAVE_CODE = /^leave:\s*([a-z0-9_]+)/i;

const num = (m: RegExpExecArray | null): number | null => (m ? Number(m[1]) : null);

/** Classify one stored deduction line. Never throws: unknown shapes fall through to `raw`. */
export function parseScLine(line: ScLineRef): ParsedScLine {
  const label = line.label ?? '';
  switch (line.source_type) {
    case 'warning': {
      const m = WARNING_LEVEL.exec(label);
      return { kind: 'warning', level: m ? m[1] : null };
    }
    case 'absent':
      return { kind: 'absent', days: num(DAYS.exec(label)) };
    case 'leave': {
      const m = LEAVE_CODE.exec(label);
      return { kind: 'leave', code: m ? m[1] : null, days: num(DAYS.exec(label)) };
    }
    case 'warning_carry':
      return { kind: 'carry', family: 'warning' };
    case 'eval_carry':
      return { kind: 'carry', family: 'eval' };
    case 'stock_penalty_carry':
      return { kind: 'carry', family: 'stock_penalty' };
    default:
      return { kind: 'raw', text: label };
  }
}
