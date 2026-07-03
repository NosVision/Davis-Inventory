// HR monthly evaluation engine (P5.1, §G) — PURE compute core, no I/O.
//
// Data flow (§G): งวด → เกณฑ์ → มอบหมาย → คะแนนดิบ → ผลเฉลี่ย → กติกาจ่ายเงิน → เงินจริง.
// This module owns the two math steps that must be exact and are the same regardless of how
// the rows are stored:
//   1. computeEvalResult  — average the SUBMITTED evaluators only, normalize to score_pct.
//   2. resolveEvalPayout  — turn score_pct into money via a linear or tiered rule (amount may
//                            be NEGATIVE = "หักจาก SC" deduction mode, §G↔§H link).
// Everything else (period/criteria/assignment CRUD, RLS, applying to the payslip) is route/DB
// work built on top of these. Money is integer satang; score_pct is a real number 0..100.

/** One evaluator's scoring of one employee for the period. `submitted` gates inclusion. */
export interface EvaluatorSubmission {
  evaluator_id: string;
  submitted: boolean;
  /** raw points across ALL criteria for this evaluator (Σ points). */
  raw_total: number;
}

export interface EvalResult {
  evaluator_count: number; // submitted evaluators only
  raw_score_avg: number; // arithmetic mean of submitted raw_total (unrounded)
  max_score: number; // snapshot: Σ criteria max_points for the period
  score_pct: number | null; // raw_score_avg / max_score × 100, capped 100; null when no data
}

/**
 * Average the submitted evaluators and normalize. §G: an evaluator who has NOT submitted is
 * excluded from the divisor entirely (NOT counted as 0). No submissions → null score_pct
 * (a month with no evaluators is a gap, not 0%). max_score ≤ 0 → null (can't normalize).
 */
export function computeEvalResult(submissions: EvaluatorSubmission[], maxScore: number): EvalResult {
  const submitted = submissions.filter((s) => s.submitted);
  const count = submitted.length;
  if (count === 0 || maxScore <= 0) {
    return { evaluator_count: count, raw_score_avg: 0, max_score: maxScore, score_pct: null };
  }
  const rawAvg = submitted.reduce((sum, s) => sum + s.raw_total, 0) / count;
  const pct = Math.min(100, (rawAvg / maxScore) * 100);
  return { evaluator_count: count, raw_score_avg: rawAvg, max_score: maxScore, score_pct: pct };
}

// ── compute-on-close aggregation (DB rows → per-employee result) ────────────────
// The route loads flat rows at period close and calls this; the math stays here so it is
// unit-testable without a DB. §G: average once at close (not live).

/** One assignment row (evaluator↔employee) with its submit status. */
export interface AssignmentRow {
  assignment_id: string;
  evaluator_id: string;
  employee_id: string;
  submitted: boolean;
}
/** One raw score cell: points a given assignment gave on a given criterion. */
export interface ScoreRow {
  assignment_id: string;
  points: number;
}

/** Anonymized per-evaluator total for an employee (§G: "ผู้ประเมิน A: 43 · B: 39" ไม่เปิดชื่อ). */
export interface EvaluatorBreakdown {
  label: string; // "A", "B", … — assigned by submit order, never the real name
  raw_total: number;
  score_pct: number | null;
}

export interface EmployeeEvalAggregate {
  employee_id: string;
  result: EvalResult;
  /** Per-evaluator totals (submitted only), anonymized — for the employee-facing breakdown. */
  breakdown: EvaluatorBreakdown[];
}

const ANON_LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Aggregate raw score rows into one result per employee for a period. Sums each assignment's
 * points across criteria, keeps SUBMITTED assignments only, averages+normalizes via
 * computeEvalResult, and produces an anonymized per-evaluator breakdown labeled A/B/C… in a
 * STABLE order (by evaluator_id) so labels don't leak identity and don't reshuffle between
 * reads. maxScore = Σ criteria.max_points snapshot for the period.
 */
export function aggregateEvalScores(
  assignments: AssignmentRow[],
  scores: ScoreRow[],
  maxScore: number,
): EmployeeEvalAggregate[] {
  const totalByAssignment = new Map<string, number>();
  for (const s of scores) {
    totalByAssignment.set(s.assignment_id, (totalByAssignment.get(s.assignment_id) ?? 0) + s.points);
  }

  const byEmployee = new Map<string, AssignmentRow[]>();
  for (const a of assignments) {
    const list = byEmployee.get(a.employee_id) ?? [];
    list.push(a);
    byEmployee.set(a.employee_id, list);
  }

  const out: EmployeeEvalAggregate[] = [];
  for (const [employeeId, rows] of byEmployee) {
    // stable order → stable anonymous labels
    const submitted = rows
      .filter((r) => r.submitted)
      .sort((x, y) => (x.evaluator_id < y.evaluator_id ? -1 : x.evaluator_id > y.evaluator_id ? 1 : 0));

    const submissions: EvaluatorSubmission[] = submitted.map((r) => ({
      evaluator_id: r.evaluator_id,
      submitted: true,
      raw_total: totalByAssignment.get(r.assignment_id) ?? 0,
    }));
    const result = computeEvalResult(submissions, maxScore);

    const breakdown: EvaluatorBreakdown[] = submitted.map((r, i) => {
      const raw = totalByAssignment.get(r.assignment_id) ?? 0;
      return {
        label: ANON_LABELS[i] ?? `#${i + 1}`,
        raw_total: raw,
        score_pct: maxScore > 0 ? Math.min(100, (raw / maxScore) * 100) : null,
      };
    });

    out.push({ employee_id: employeeId, result, breakdown });
  }
  return out;
}

export type EvalFormulaType = 'linear' | 'tiered';

/** linear: amount = flat_satang + round(satang_per_pct × score_pct). */
export interface LinearRule {
  formula_type: 'linear';
  flat_satang: number;
  satang_per_pct: number;
}
/** tiered: first tier whose [min_pct, max_pct] contains score_pct wins; amount may be negative. */
export interface EvalTier {
  id: string;
  min_pct: number;
  max_pct: number;
  amount_satang: number;
  label?: string | null;
}
export interface TieredRule {
  formula_type: 'tiered';
  tiers: EvalTier[];
}
export type EvalPayoutRule = LinearRule | TieredRule;

export interface EvalPayout {
  amount_satang: number; // may be negative (deduction from SC, §G↔§H)
  tier_matched_id: string | null; // set for tiered rules
  input_pct_score: number; // the score_pct fed in (snapshot)
  note: string;
}

/**
 * Turn a score_pct into money. Input is ALWAYS score_pct (0..100), never the raw score, so a
 * rule works across months whose max_score differs. A null score_pct (no evaluators) yields 0.
 * Tiers are matched inclusive on both ends; the FIRST matching tier wins, so callers order
 * tiers without overlap. No tier matches → 0 with a note (not an error — an unscored band pays
 * nothing). Linear rounds to satang once at the end.
 */
export function resolveEvalPayout(rule: EvalPayoutRule, scorePct: number | null): EvalPayout {
  if (scorePct === null) {
    return { amount_satang: 0, tier_matched_id: null, input_pct_score: 0, note: 'no score (no evaluators)' };
  }
  const pct = Math.max(0, Math.min(100, scorePct));

  if (rule.formula_type === 'linear') {
    const amount = rule.flat_satang + Math.round(rule.satang_per_pct * pct);
    return { amount_satang: amount, tier_matched_id: null, input_pct_score: pct, note: `linear @ ${pct.toFixed(2)}%` };
  }

  for (const tier of rule.tiers) {
    if (pct >= tier.min_pct && pct <= tier.max_pct) {
      return {
        amount_satang: tier.amount_satang,
        tier_matched_id: tier.id,
        input_pct_score: pct,
        note: `tier ${tier.label ?? `${tier.min_pct}-${tier.max_pct}%`}`,
      };
    }
  }
  return { amount_satang: 0, tier_matched_id: null, input_pct_score: pct, note: `no tier matched ${pct.toFixed(2)}%` };
}
