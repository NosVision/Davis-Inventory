/**
 * Catch a second employee record for someone the register already knows.
 *
 * Nothing checked for this: hr_employees is unique on profile_id and employee_code only, so two
 * different logins for the same human each get their own record, their own payslip and their own
 * line in the bank transfer file. A test account was created for an existing employee and linked
 * with her name and (near-)bank account, and nothing objected (owner report 2026-08-11).
 *
 * Exact matching would not have caught it either — the name lacked the นางสาว prefix, the account
 * number had a stray extra digit, and the rate differed by one satang. So compare on a normalised
 * form: the name without its honorific, the account as digits only.
 *
 * Reported, not blocked. Two people really can share a name, and a shared household bank account
 * is unusual but legitimate — HR has to be the judge. A duplicate bank account is the serious one:
 * that is the same account being paid twice.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

const HONORIFIC = /^(นาย|นางสาว|นาง|น\.ส\.|ด\.ช\.|ด\.ญ\.|mr\.?|mrs\.?|miss|ms\.?)\s*/i;

/** Name without honorific, collapsed whitespace, lowercased. '' when there is nothing to compare. */
export function normalizeEmployeeName(raw: string | null | undefined): string {
  return (raw ?? '').trim().replace(HONORIFIC, '').replace(/\s+/g, ' ').toLowerCase();
}

/** Bank account as digits only — defeats spacing, dashes and formatting differences. */
export function normalizeAccountDigits(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\D/g, '');
}

export interface DuplicateMatch {
  employee_id: string;
  profile_id: string;
  full_name: string | null;
  status: string | null;
  username: string | null;
  /** Which field collided. A bank match is the one that causes a double payment. */
  on: 'name' | 'bank_account';
}

/**
 * Existing employees that look like the same person. `excludeEmployeeId` skips the record being
 * edited so updating someone never flags them against themselves.
 */
export async function findDuplicateEmployees(
  service: SupabaseClient,
  candidate: { full_name?: string | null; bank_account_no?: string | null },
  excludeEmployeeId?: string | null
): Promise<DuplicateMatch[]> {
  const name = normalizeEmployeeName(candidate.full_name);
  const acct = normalizeAccountDigits(candidate.bank_account_no);
  if (!name && !acct) return [];

  // Resigned/terminated records are still worth flagging: a rehire should reuse the existing
  // record rather than start a second one, and their bank account is still theirs.
  const { data } = await service
    .from('hr_employees')
    .select('id, profile_id, full_name, status, bank_account_no, profile:profiles!hr_employees_profile_id_fkey(username)');

  const out: DuplicateMatch[] = [];
  for (const row of (data ?? []) as {
    id: string;
    profile_id: string;
    full_name: string | null;
    status: string | null;
    bank_account_no: string | null;
    profile: { username: string | null } | { username: string | null }[] | null;
  }[]) {
    if (excludeEmployeeId && row.id === excludeEmployeeId) continue;
    const prof = Array.isArray(row.profile) ? row.profile[0] : row.profile;
    const base = {
      employee_id: row.id,
      profile_id: row.profile_id,
      full_name: row.full_name,
      status: row.status,
      username: prof?.username ?? null,
    };
    // Bank first: it is the finding that matters most, and one entry per match reads better than
    // the same person listed twice.
    if (acct && normalizeAccountDigits(row.bank_account_no) === acct) {
      out.push({ ...base, on: 'bank_account' });
    } else if (name && normalizeEmployeeName(row.full_name) === name) {
      out.push({ ...base, on: 'name' });
    }
  }
  return out;
}

/** One-line Thai summary for a toast or a confirm dialog. */
export function describeDuplicates(matches: readonly DuplicateMatch[]): string {
  const bank = matches.filter((m) => m.on === 'bank_account');
  const name = matches.filter((m) => m.on === 'name');
  const parts: string[] = [];
  if (bank.length) {
    parts.push(
      `เลขบัญชีธนาคารซ้ำกับ ${bank.map((m) => `${m.full_name ?? '—'} (@${m.username ?? '—'})`).join(', ')} — เสี่ยงโอนเงินซ้ำเข้าบัญชีเดียวกัน`
    );
  }
  if (name.length) {
    parts.push(
      `ชื่อ-นามสกุลซ้ำกับ ${name.map((m) => `${m.full_name ?? '—'} (@${m.username ?? '—'})`).join(', ')}`
    );
  }
  return parts.join(' · ');
}
