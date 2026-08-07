// Shared stock-count variance logic — the single source of truth for
// "is this difference within tolerance / does it need explaining?".
//
// Owner ask 2026-07-10: a whole bottle of Dom Pérignon (POS 31 / counted 30 =
// −1 = only −3.23%) was being auto-approved by the old "within % OR within
// units" rule and never surfaced on the "needs explanation" page. Expensive,
// high-count, whole-bottle stock must flag on ANY missing bottle; pour items
// (measured by fill level) should still tolerate small % wobble.
//
// Kept side-effect free so the server (compare API) and the client
// (comparison page display) share ONE decision and can never drift apart.

export type VarianceMode = 'auto' | 'unit' | 'percent';

export interface ToleranceConfig {
  /** Absolute-unit tolerance for pour items (store_settings.diff_tolerance_unit, default 0.4). */
  unit: number;
  /** Percentage tolerance for pour items (store_settings.diff_tolerance, default 5). */
  percent: number;
}

export const DEFAULT_TOLERANCE: ToleranceConfig = { unit: 0.4, percent: 5 };

// A whole bottle. In unit ("นับเป็นขวด") mode anything this far off — or more —
// must be explained, no matter how small the percentage looks.
export const BOTTLE_UNIT_THRESHOLD = 1;

/**
 * Resolve the effective mode for one comparison row.
 *
 * 'auto' inspects the numbers coming from POS + the manual count: when BOTH
 * sides are whole integers the item is stocked/sold as sealed whole units
 * (champagne, premium spirits) → treat as `unit`. A fractional value on either
 * side means it is measured by fill level (pour) → treat as `percent`.
 *
 * An explicit 'unit' / 'percent' override on the product always wins.
 */
export function resolveVarianceMode(
  manual: number | null,
  pos: number | null,
  override: VarianceMode | null | undefined,
): 'unit' | 'percent' {
  if (override === 'unit' || override === 'percent') return override;
  const bothWhole =
    manual !== null &&
    pos !== null &&
    Number.isInteger(manual) &&
    Number.isInteger(pos);
  return bothWhole ? 'unit' : 'percent';
}

/**
 * Is this difference within tolerance (auto-approved — no explanation needed)?
 *
 * A missing whole unit ALWAYS has to be explained, in either mode (owner decision 2026-08-07).
 * The 2026-07-10 fix only closed this for `unit` mode, and `unit` mode is reached only when BOTH
 * sides are whole integers — so a pour item counted to one decimal slipped straight past it:
 * Reguta Red 27.10 vs 28.50 is −1.40 bottles but only −4.91%, under the 5% bar, auto-approved.
 * That is the same hole the Dom Pérignon case was reported for, just wearing decimals.
 *
 *  - >= 1 unit off  → always explained, whatever the percentage says.
 *  - below 1 unit   → unit mode forgives it; percent mode keeps the old
 *                     "small absolute amount OR small percentage" rule, so genuine
 *                     pour wobble (a few ml of evaporation/measurement error) stays quiet.
 *
 * The percent branch is deliberately still an OR *below* one unit: tightening it to AND there
 * would flag sub-0.4-unit rounding noise on low-stock items, which is not a real shortage.
 */
export function isVarianceWithinTolerance(params: {
  difference: number;
  diffPercent: number | null;
  mode: 'unit' | 'percent';
  tolerance?: ToleranceConfig;
}): boolean {
  const { difference, diffPercent, mode } = params;
  const tolerance = params.tolerance ?? DEFAULT_TOLERANCE;
  const absDiff = Math.abs(difference);

  // The floor both modes share: a whole unit gone is a whole unit gone.
  if (absDiff >= BOTTLE_UNIT_THRESHOLD) return false;

  if (mode === 'unit') return true;
  return (
    absDiff <= tolerance.unit ||
    (diffPercent !== null && Math.abs(diffPercent) <= tolerance.percent)
  );
}

/**
 * Convenience: given the raw values + optional per-product override, decide
 * whether the row is within tolerance. Handles mode resolution in one call.
 */
export function isWithinToleranceFor(params: {
  manual: number | null;
  pos: number | null;
  difference: number;
  diffPercent: number | null;
  override?: VarianceMode | null;
  tolerance?: ToleranceConfig;
}): boolean {
  const mode = resolveVarianceMode(params.manual, params.pos, params.override);
  return isVarianceWithinTolerance({
    difference: params.difference,
    diffPercent: params.diffPercent,
    mode,
    tolerance: params.tolerance,
  });
}
