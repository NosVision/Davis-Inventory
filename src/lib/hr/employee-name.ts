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

/**
 * Does this person match a typed search? Used by the leave-quota grid, where 131 rows is too many
 * to scan for one person.
 *
 * Every token must appear somewhere in "ชื่อจริงนามสกุล ชื่อเล่น", so word order does not matter.
 * hr_employees.full_name holds the first and last name in one string, and typing them the other way
 * round is the obvious thing to do when the surname is what you remember. Case-insensitive, because
 * the nicknames on file are a mix of Thai, "Aum" and "tan5566".
 *
 * An empty query matches everyone — the caller shows the unfiltered list rather than nothing.
 */
export function matchesEmployeeSearch(
  person: { name: string; nickname?: string | null },
  query: string
): boolean {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const haystack = `${person.name} ${person.nickname ?? ''}`.toLowerCase();
  return tokens.every((tok) => haystack.includes(tok));
}

/**
 * One spelling for a legal name, however it was typed.
 *
 * Three writers produce hr_employees.full_name — the HR form ("นาย สมชาย ใจดี", hint said to
 * leave a space), employee self-service ("นายสมชาย ใจดี", prefix glued on) and self-registration
 * (anything at all) — and HR then sees three spellings of one person across the roster, the
 * timesheet and the payroll register (client report 2026-09-07/09). The payroll sheets the module
 * was seeded from write Thai honorifics glued to the given name and English ones with a space
 * ("นายพันธุ์ธัช เธียรธราสิทธิ์", "Mr. Pantouch Thaintarasit"), so that is the canonical form.
 *
 * Rules: trim, collapse whitespace, drop the space after a Thai honorific, put exactly one space
 * after an English one (with its dot), title-case the English honorific. Anything that is not an
 * honorific is left exactly as typed — this never guesses at a person's name.
 */
const THAI_HONORIFIC = /^(นางสาว|นาง|นาย|น\.ส\.|ด\.ช\.|ด\.ญ\.)\s+/u;
const ENGLISH_HONORIFIC = /^(mr|mrs|ms|miss|dr)\.?\s*(?=\S)/iu;
const ENGLISH_HONORIFIC_CANON: Record<string, string> = {
  mr: 'Mr.',
  mrs: 'Mrs.',
  ms: 'Ms.',
  miss: 'Miss',
  dr: 'Dr.',
};

export function normalizeFullName(raw: string | null | undefined): string | null {
  const collapsed = (raw ?? '').replace(/\s+/gu, ' ').trim();
  if (!collapsed) return null;
  const thai = collapsed.match(THAI_HONORIFIC);
  if (thai) return `${thai[1]}${collapsed.slice(thai[0].length)}`;
  const english = collapsed.match(ENGLISH_HONORIFIC);
  if (english) {
    const canon = ENGLISH_HONORIFIC_CANON[english[1].toLowerCase()];
    return `${canon} ${collapsed.slice(english[0].length)}`;
  }
  return collapsed;
}
