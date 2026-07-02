import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

interface ProfileRow {
  id: string;
  username: string | null;
  display_name: string | null;
}

// GET /api/hr/ess/coworkers — the caller's store-mates, so a requester can pick a
// day-off swap counterpart (§C, P2.3a). Returns the distinct set of profiles who
// share ANY store with the caller (caller's stores → other members of those stores),
// excluding the caller. Auth-any: any authenticated employee reads their own peers.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const service = createServiceClient();

  // The caller's own store assignments.
  const { data: myStores, error: myErr } = await service
    .from('user_stores')
    .select('store_id')
    .eq('user_id', user.id);
  if (myErr) return NextResponse.json({ error: 'Failed to load coworkers' }, { status: 500 });
  const storeIds = [...new Set((myStores ?? []).map((r) => r.store_id as string))];
  if (!storeIds.length) return NextResponse.json({ data: [] });

  // Everyone assigned to any of those stores → distinct, minus the caller.
  const { data: members, error: membersErr } = await service
    .from('user_stores')
    .select('user_id')
    .in('store_id', storeIds);
  if (membersErr) return NextResponse.json({ error: 'Failed to load coworkers' }, { status: 500 });
  const userIds = [...new Set((members ?? []).map((r) => r.user_id as string))].filter(
    (id) => id !== user.id
  );
  if (!userIds.length) return NextResponse.json({ data: [] });

  const { data: profiles, error: profErr } = await service
    .from('profiles')
    .select('id, username, display_name')
    .in('id', userIds);
  if (profErr) return NextResponse.json({ error: 'Failed to load coworkers' }, { status: 500 });

  const out = ((profiles ?? []) as ProfileRow[])
    .map((p) => ({ user_id: p.id, name: p.display_name || p.username || '—' }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return NextResponse.json({ data: out });
}
