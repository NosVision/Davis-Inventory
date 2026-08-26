/**
 * Who may issue the company-wide statutory documents — ภ.ง.ด.1 / สปส.1-10 / ทะเบียนค่าจ้าง /
 * 50 ทวิ / ภ.ง.ด.1ก.
 *
 * These filings must list EVERY employee of a company across every payroll group, so there is no
 * partial version to hand a single group's manager (see refuseIfConfidentialInScope). The right to
 * produce them is therefore `can_view_confidential_pay` — the same grant that lifts every pay veil
 * in the module. Naming it "confidential pay" only told half the truth, which is why the screens
 * and the permission label now say the rest: this person files the company's tax, and sees every
 * group's salaries because those filings contain them.
 *
 * Owners hold it implicitly through their role and cannot be removed. Everyone else holds it as an
 * explicit user_permissions row, which is what this module adds and removes.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { buildEmployeeNameMap } from '@/lib/hr/employee-name-map';
import { CONFIDENTIAL_PAY_PERMISSION } from '@/lib/hr/pay-visibility';
import type { DocumentIssuer } from '@/lib/hr/issuer-label';

export { describeIssuers } from '@/lib/hr/issuer-label';
export type { DocumentIssuer } from '@/lib/hr/issuer-label';

export interface IssuerCandidate {
  user_id: string;
  name: string;
  nickname: string | null;
  role: string;
  /** Already an issuer (explicitly or as an owner). */
  is_issuer: boolean;
  /** An owner: shown ticked and disabled, since the right cannot be taken from them here. */
  implicit: boolean;
}

interface ProfileRow {
  id: string;
  username: string;
  display_name: string | null;
  role: string;
  is_system: boolean | null;
}

/**
 * Active, human accounts that could hold the right — anyone who can already run HR.
 * `is_system` accounts (break-glass and test logins) are excluded: naming them on a screen tells
 * every HR user which accounts exist without letting anyone do anything useful with the knowledge.
 */
async function hrCapableProfiles(service: SupabaseClient): Promise<ProfileRow[]> {
  const [{ data: profiles }, { data: grants }] = await Promise.all([
    service.from('profiles').select('id, username, display_name, role, is_system').eq('active', true),
    service.from('user_permissions').select('user_id').eq('permission', 'can_manage_hr'),
  ]);
  const hrGranted = new Set((grants ?? []).map((g) => g.user_id as string));
  return ((profiles ?? []) as ProfileRow[]).filter(
    (p) => !p.is_system && (p.role === 'owner' || p.role === 'hr' || hrGranted.has(p.id))
  );
}

/** profiles.id of everyone holding an explicit can_view_confidential_pay grant. */
async function explicitGrantIds(service: SupabaseClient): Promise<Set<string>> {
  const { data } = await service
    .from('user_permissions')
    .select('user_id')
    .eq('permission', CONFIDENTIAL_PAY_PERMISSION);
  return new Set((data ?? []).map((g) => g.user_id as string));
}

/**
 * The issuers, and the people who could become one.
 *
 * Computed from the SAME rule the server enforces (owner role OR the explicit grant) rather than
 * guessed from a role list — an earlier screen listed every role='hr' user as an issuer, which put
 * a name on the banner for someone who could not actually issue anything.
 */
export async function loadDocumentIssuers(service: SupabaseClient): Promise<{
  issuers: DocumentIssuer[];
  candidates: IssuerCandidate[];
}> {
  const [people, granted] = await Promise.all([hrCapableProfiles(service), explicitGrantIds(service)]);
  const names = await buildEmployeeNameMap(
    service,
    people.map((p) => p.id)
  );

  const decorate = (p: ProfileRow) => ({
    user_id: p.id,
    name: names.get(p.id)?.name ?? p.display_name ?? p.username,
    nickname: names.get(p.id)?.nickname ?? null,
  });

  const issuers: DocumentIssuer[] = people
    .filter((p) => p.role === 'owner' || granted.has(p.id))
    .map((p) => ({ ...decorate(p), implicit: p.role === 'owner' }))
    .sort((a, b) => Number(a.implicit) - Number(b.implicit) || a.name.localeCompare(b.name, 'th'));

  const candidates: IssuerCandidate[] = people
    .map((p) => ({
      ...decorate(p),
      role: p.role,
      implicit: p.role === 'owner',
      is_issuer: p.role === 'owner' || granted.has(p.id),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'th'));

  return { issuers, candidates };
}
