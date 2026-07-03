// HR evaluation config helpers (P5.1, §G/§E) — pure, no I/O.
// The default 15-criterion template from the client manual, used to seed a period's first
// criteria set. HR can then edit/add/remove while the period is still draft.

export interface DefaultCriterion {
  sort_order: number;
  name: string;
  max_points: number;
}

/** §E 15 หัวข้อ; default 10 points each (max_score 150). HR overrides per period. */
export const DEFAULT_EVAL_CRITERIA: readonly DefaultCriterion[] = [
  'ทำตามคำสั่งหัวหน้า', 'ความขยัน', 'การแต่งกาย', 'บริการลูกค้า', 'ความสะอาด',
  'ความแม่นยำออร์เดอร์', 'ความเร็ว', 'การเรียนรู้', 'การสื่อสาร', 'การแก้ปัญหา',
  'ความซื่อสัตย์ (ไม่ขอทิป)', 'ทีมเวิร์ก', 'การดูแลร้าน', 'วินัย', 'ตรงเวลา',
].map((name, i) => ({ sort_order: i + 1, name, max_points: 10 }));

/** Σ max_points of a criteria set — the period's max_score cache. */
export function sumMaxScore(criteria: { max_points: number }[]): number {
  return criteria.reduce((sum, c) => sum + (Number.isFinite(c.max_points) ? c.max_points : 0), 0);
}

export const EVAL_PERIOD_STATUSES = ['draft', 'open', 'closed', 'void'] as const;
export type EvalPeriodStatus = (typeof EVAL_PERIOD_STATUSES)[number];

const MONTH_RE = /^\d{4}-\d{2}-01$/;

export interface EvalPeriodInput {
  period_month: string; // YYYY-MM-01
  title: string;
  scope_type: 'company' | 'stores';
}
export type EvalPeriodParse =
  | { ok: true; fields: EvalPeriodInput }
  | { ok: false; error: string };

/** Validate a new/edited period's core fields. */
export function parseEvalPeriod(body: Record<string, unknown>): EvalPeriodParse {
  const periodMonth = typeof body.period_month === 'string' ? body.period_month : '';
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const scopeType = body.scope_type === 'stores' ? 'stores' : 'company';
  if (!MONTH_RE.test(periodMonth)) {
    return { ok: false, error: 'period_month must be YYYY-MM-01' };
  }
  if (!title) return { ok: false, error: 'title is required' };
  return { ok: true, fields: { period_month: periodMonth, title, scope_type: scopeType } };
}
