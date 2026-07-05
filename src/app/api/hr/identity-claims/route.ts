import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';

// GET /api/hr/identity-claims — HR review queue for the identity-claim flow: claims awaiting
// verification (who in the app says they are which sheet name), plus the not-yet-claimed and
// already-linked tallies so HR sees import coverage at a glance.
export async function GET() {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const service = createServiceClient();
  const [{ data: claims, error: cErr }, unclaimedRes, linkedRes] = await Promise.all([
    service
      .from('hr_pending_identities')
      .select(
        'id, full_name_th, position_text, start_date, sheet_ref, claimed_at, ' +
          'company:hr_companies(name), store:stores(store_name), ' +
          'claimant:profiles!hr_pending_identities_claimed_by_fkey(id, username, display_name, avatar_url)'
      )
      .eq('status', 'claimed')
      .order('claimed_at', { ascending: true }),
    service.from('hr_pending_identities').select('id, full_name_th, store:stores(store_name)', { count: 'exact' }).eq('status', 'unclaimed').order('full_name_th'),
    service.from('hr_pending_identities').select('id', { count: 'exact', head: true }).eq('status', 'linked'),
  ]);
  if (cErr || unclaimedRes.error || linkedRes.error) {
    return NextResponse.json({ error: 'Failed to load identity claims' }, { status: 500 });
  }

  return NextResponse.json({
    data: {
      claims: claims ?? [],
      unclaimed: unclaimedRes.data ?? [],
      counts: {
        claimed: (claims ?? []).length,
        unclaimed: unclaimedRes.count ?? 0,
        linked: linkedRes.count ?? 0,
      },
    },
  });
}
