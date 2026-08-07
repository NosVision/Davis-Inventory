/**
 * One way to name a person across every HR surface.
 *
 * There are two names for the same human and they routinely disagree:
 *   • hr_employees.full_name   — the legal ชื่อ-นามสกุล payroll and the tax office use
 *   • profiles.display_name    — the ชื่อเล่น they are known by in chat/schedule
 *
 * 114 of 124 linked accounts have different values in the two columns, so whichever one a screen
 * happened to pick decided which name HR saw. /hr/payroll settled it (client ask 2026-07-21):
 * lead with the real name, keep the nickname beside it, and fall back to the account only for
 * someone with no employee record yet. These helpers are that rule, so no screen has to re-derive it.
 *
 * Pure functions — safe on the server and in client components.
 */

export interface EmployeeNameSource {
  /** hr_employees.full_name */
  full_name?: string | null;
  /** profiles.display_name */
  display_name?: string | null;
  /** profiles.username */
  username?: string | null;
}

export interface EmployeeName {
  /** What to show first: the real name when we have one. Never empty. */
  name: string;
  /** The nickname, only when it adds something the name does not already say. */
  nickname: string | null;
}

/**
 * ชื่อจริง (ชื่อเล่น) — or just the account name when the person has no employee record.
 * `nickname` is null whenever showing it would only repeat `name`.
 */
export function resolveEmployeeName(src: EmployeeNameSource | null | undefined): EmployeeName {
  const full = src?.full_name?.trim() || '';
  const nick = src?.display_name?.trim() || '';
  const user = src?.username?.trim() || '';

  if (full) return { name: full, nickname: nick && nick !== full ? nick : null };
  // Unlinked account: the nickname IS the only name we have, so it leads and nothing trails it.
  return { name: nick || user || '—', nickname: null };
}

/** Single-string form for PDFs, exports, notifications and CSV — "ชื่อจริง (ชื่อเล่น)". */
export function employeeNameLabel(src: EmployeeNameSource | null | undefined): string {
  const { name, nickname } = resolveEmployeeName(src);
  return nickname ? `${name} (${nickname})` : name;
}

/** True when this row is a real employee rather than a bare login. Drives "ยังไม่ยืนยันตัวตน" hints. */
export function hasEmployeeRecord(src: EmployeeNameSource | null | undefined): boolean {
  return !!src?.full_name?.trim();
}
