import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

// GET /api/hr/ess/policies — employee self-service.
// Any authenticated user may read the active policies plus their own ack state.
// NOT gated by requireHrManager — this is ESS, reachable by every employee.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const service = createServiceClient();
  const [policiesRes, acksRes] = await Promise.all([
    service
      .from('hr_policies')
      .select('id,title,category,body,version,sort_order')
      .eq('active', true)
      .order('sort_order')
      .order('title'),
    service
      .from('hr_policy_acknowledgements')
      .select('policy_id,policy_version,acked_at')
      .eq('user_id', user.id),
  ]);

  if (policiesRes.error) {
    return NextResponse.json({ error: policiesRes.error.message }, { status: 500 });
  }
  if (acksRes.error) {
    return NextResponse.json({ error: acksRes.error.message }, { status: 500 });
  }

  const acks = acksRes.data ?? [];
  const data = (policiesRes.data ?? []).map((p) => {
    const ack = acks.find((a) => a.policy_id === p.id && a.policy_version === p.version);
    return { ...p, acked: !!ack, acked_at: ack?.acked_at ?? null };
  });

  return NextResponse.json({ data });
}
