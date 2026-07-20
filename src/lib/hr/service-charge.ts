// HR Service Charge deduction math (P4.1, §H) — PURE, satang-exact.
// A person's SC allocation is entered manually; these helpers compute how much is
// deducted from it. Money is always integer satang. Deductions can exceed a single
// period's allocation (notably a 200% warning = 2 months of SC), in which case the
// overflow is CARRIED to the next period rather than lost or going negative.

export const SC_DAY_DIVISOR = 30; // §A/§H: a leave day docks 1/30 of the month's SC.

export interface ScDeductionResult {
  /** deducted from THIS period's allocation (never exceeds `allocated`) */
  amount_satang: number;
  /** overflow to carry to the next period (e.g. the 2nd month of a 200% warning) */
  carry_satang: number;
}

/** Clamp a raw deduction to the allocation, carrying any overflow. */
function splitWithCarry(rawDeduct: number, allocated: number): ScDeductionResult {
  const raw = Math.max(0, Math.round(rawDeduct));
  const amount = Math.min(raw, Math.max(0, allocated));
  return { amount_satang: amount, carry_satang: raw - amount };
}

/**
 * Apply a prior period's carried-over deduction (e.g. the 2nd month of a 200% warning, or the
 * residual of a large amount_baht penalty) against THIS period's allocation, carrying any part
 * that still overflows to the next period. Same clamp-with-carry semantics as a warning.
 */
export function computeCarryScDeduction(allocated: number, priorCarrySatang: number): ScDeductionResult {
  if (priorCarrySatang <= 0) return { amount_satang: 0, carry_satang: 0 };
  return splitWithCarry(priorCarrySatang, allocated);
}

export interface WarningScInput {
  /** verbal | deduct_25 | deduct_50 | deduct_100 | deduct_200 | amount_baht */
  level: string;
  /** 25 | 50 | 100 | 200 for the percent levels, else null */
  sc_deduct_percent: number | null;
  /** set only for level='amount_baht' */
  amount_satang: number | null;
}

/**
 * §H warning → SC deduction. Percent levels deduct that % of the person's SC for the
 * month ("% ของยอด SC ที่คนนั้นได้เดือนนั้น"); 200% therefore takes the full month plus a
 * full-month carry (SC 2 เดือน). A free-form baht warning deducts the fixed amount, carrying
 * any part that exceeds this month's allocation. A verbal warning deducts nothing.
 */
export function computeWarningScDeduction(
  allocated: number,
  w: WarningScInput,
): ScDeductionResult {
  if (w.level === 'amount_baht') {
    return splitWithCarry(w.amount_satang ?? 0, allocated);
  }
  if (typeof w.sc_deduct_percent === 'number' && w.sc_deduct_percent > 0) {
    return splitWithCarry((allocated * w.sc_deduct_percent) / 100, allocated);
  }
  // verbal / no SC effect
  return { amount_satang: 0, carry_satang: 0 };
}

/**
 * §H leave → SC deduction. Each SC-deducting leave day docks 1/30 of the month's SC
 * (personal leave and sick-without-cert deduct SC; sick-with-cert also deducts SC but keeps
 * salary — the caller decides `scLeaveDays` via classifyLeaveEffect). No carry.
 */
export function computeLeaveScDeduction(
  allocated: number,
  scLeaveDays: number,
  divisor: number = SC_DAY_DIVISOR // owner-tunable via hr_policy_settings 'sc_leave_divisor'
): ScDeductionResult {
  if (scLeaveDays <= 0 || allocated <= 0) return { amount_satang: 0, carry_satang: 0 };
  const raw = Math.round((allocated * scLeaveDays) / divisor);
  const amount = Math.min(raw, allocated);
  return { amount_satang: amount, carry_satang: 0 };
}

/**
 * §G↔§H eval → SC deduction. A monthly evaluation payout in "deduction mode" is a NEGATIVE
 * amount (e.g. avg 50% → −200 บาท). Its magnitude is docked from the person's SC for the month,
 * carrying any overflow past this month's allocation (same clamp-with-carry as a warning). A
 * zero or POSITIVE payout deducts nothing from SC — a positive eval payout is a bonus paid via
 * the payslip (type='eval_bonus'), not an SC line, so it must not reduce SC here.
 */
export function computeEvalScDeduction(allocated: number, evalPayoutSatang: number): ScDeductionResult {
  if (evalPayoutSatang >= 0) return { amount_satang: 0, carry_satang: 0 };
  return splitWithCarry(-evalPayoutSatang, allocated);
}

/**
 * Stock-penalty → SC deduction (owner ask 2026-07-09). A person's accumulated stock fines for the
 * month (baht → satang) are docked from their SC for that month, carrying any part past this
 * month's allocation to the next period (same clamp-with-carry as eval/warning). Fines are the
 * money; discipline (SOP points → head_bar warning) is tracked separately. See
 * docs/hr/stock-penalty-to-hr.md.
 */
export function computeStockPenaltyScDeduction(allocated: number, penaltySatang: number): ScDeductionResult {
  if (penaltySatang <= 0) return { amount_satang: 0, carry_satang: 0 };
  return splitWithCarry(penaltySatang, allocated);
}

/** Net SC = allocation − total deducted this period, floored at 0. */
export function computeNetSc(allocated: number, deductions: { amount_satang: number }[]): number {
  const total = deductions.reduce((s, d) => s + Math.max(0, d.amount_satang), 0);
  return Math.max(0, allocated - total);
}

// ── Aggregate insufficient-balance deferral (§H) ────────────────────────────────────────────────
// Each source above clamps its own overflow against the FULL allocation independently. But when
// SEVERAL sources hit one person in a month, their COMBINED total can exceed the SC pool — and the
// excess used to be silently dropped (net floored at 0). This reconciles all of a person's lines
// against ONE shrinking balance so the collective overflow is DEFERRED (carried), never lost.
//
// Order (applied first → last): reductions that CANNOT carry go first so they consume the balance
// while it lasts (leave is a genuine earnings reduction, not a debt; manual is HR's own call); then
// the carryable DEBTS — warning → stock penalty → evaluation — whose overflow carries to next month
// in that priority (so warnings collect first, eval defers first).
//
// A NON-carry source keeps its FULL intended amount_satang (it is never truncated — there's nowhere
// to defer it, and truncating would silently lose an HR-entered manual deduction that must re-apply
// if the balance later frees up). It still consumes the shared balance in full, so the carryable
// debts defer correctly, and computeNetSc floors the person's net at 0. This also makes the split
// idempotent for every source (amount+carry always re-equals the intended total).

const SC_CARRY_ELIGIBLE = new Set([
  'warning', 'warning_carry', 'stock_penalty', 'stock_penalty_carry', 'eval', 'eval_carry',
]);
// Lower rank = applied earlier against the balance.
const SC_RECONCILE_RANK: Record<string, number> = {
  leave: 0, absent: 0, manual: 1, late: 1,
  warning: 2, warning_carry: 2,
  stock_penalty: 3, stock_penalty_carry: 3,
  eval: 4, eval_carry: 4,
};

/** Whether a deduction source can defer (carry) its unpaid overflow to the next period. */
export function isScCarryEligible(sourceType: string): boolean {
  return SC_CARRY_ELIGIBLE.has(sourceType);
}

export interface ScReconcileLine {
  source_type: string;
  /** the FULL intended deduction for this line (= its amount_satang + carry_satang) */
  intended_satang: number;
}

/**
 * Split every line's applied vs carried amount against a single shared, shrinking balance, in
 * priority order. Returns results in the SAME order as the input. Pure + satang-exact + idempotent
 * for carry-eligible lines (amount+carry always re-equals intended).
 */
export function reconcileScDeductions(allocated: number, lines: ScReconcileLine[]): ScDeductionResult[] {
  const order = lines.map((_, i) => i).sort((a, b) => {
    const ra = SC_RECONCILE_RANK[lines[a].source_type] ?? 9;
    const rb = SC_RECONCILE_RANK[lines[b].source_type] ?? 9;
    return ra - rb || a - b; // stable within a rank by original index
  });
  const out: ScDeductionResult[] = lines.map(() => ({ amount_satang: 0, carry_satang: 0 }));
  let remaining = Math.max(0, Math.round(allocated));
  for (const i of order) {
    const intended = Math.max(0, Math.round(lines[i].intended_satang));
    if (SC_CARRY_ELIGIBLE.has(lines[i].source_type)) {
      // Debt: apply what fits against the remaining balance, defer the rest to next month.
      const applied = Math.min(intended, Math.max(0, remaining));
      remaining -= applied;
      out[i] = { amount_satang: applied, carry_satang: intended - applied };
    } else {
      // Reduction (leave/manual/late): keep the full amount, never truncate; it still draws down the
      // shared balance (may go negative) so debts below defer correctly, and net floors at 0 elsewhere.
      remaining -= intended;
      out[i] = { amount_satang: intended, carry_satang: 0 };
    }
  }
  return out;
}
