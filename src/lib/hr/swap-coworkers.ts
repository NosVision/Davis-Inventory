import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveRoster, type RosterMember } from './roster';

export interface SwapCoworker {
  user_id: string;
  name: string;
}

// Keep distinct people even when they share a nickname; discard duplicate memberships.
export function swapCoworkerOptions(members: readonly RosterMember[], callerId: string): SwapCoworker[] {
  const people = new Map<string, SwapCoworker>();
  for (const member of members) {
    if (member.profile_id === callerId || !['active', 'probation'].includes(member.status ?? '')) continue;
    const nickname = member.display_name || member.username || '';
    const fullName = member.full_name?.trim();
    const label = fullName && nickname && fullName !== nickname
      ? `${fullName} (${nickname})` : fullName || nickname || '—';
    // Usernames distinguish two active logins with the same displayed name.
    const name = member.username ? `${label} · ${member.username}` : label;
    people.set(member.profile_id, { user_id: member.profile_id, name });
  }
  return [...people.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadSwapCoworkers(
  service: SupabaseClient,
  storeIds: readonly string[],
  callerId: string,
  from: string,
  to = from,
): Promise<SwapCoworker[]> {
  const rosters = await Promise.all([...new Set(storeIds)].map((storeId) =>
    resolveRoster(service, { scope: { kind: 'store', storeId }, from, to })
  ));
  return swapCoworkerOptions(rosters.flatMap((roster) => roster.members), callerId);
}
