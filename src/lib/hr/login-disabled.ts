/**
 * A switched-off login takes an EMPLOYED record out of pay and off the venue lists.
 *
 * profiles.active ("can they open the app") and hr_employees.status ("are they employed") used to be
 * fully independent, and HR read one as the other: one person self-registered twice, HR disabled the
 * spare login, and the spare record — still `probation` — kept its own payslip (owner report
 * 2026-10-05: นางสาวพาย ชัน paid twice; nine more records sat in the same state, four of them with
 * a draft slip). Owner decision the same day: a disabled login means "do not pay".
 *
 * Leavers are deliberately NOT covered. Offboarding switches the login off on purpose while the
 * person is still owed their final, prorated month — their resigned/terminated status plus end date
 * keep them in pay exactly as before. So the rule only bites a record HR still calls working.
 */

const DEPARTED: ReadonlySet<string> = new Set(['resigned', 'terminated']);

/** True when this employed (non-departed) record belongs to a login that has been switched off. */
export function isDisabledLoginEmployee(
  emp: { status: string | null },
  profileActive: boolean | null | undefined
): boolean {
  if (profileActive !== false) return false;
  return !emp.status || !DEPARTED.has(emp.status);
}
