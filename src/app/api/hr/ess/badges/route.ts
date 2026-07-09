import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { NOTIF_TILE } from '@/lib/hr/ess-notif-tiles';
import { policyAppliesToRole } from '@/lib/hr/policy-scope';

// GET /api/hr/ess/badges — per-tile "needs attention" counts for the employee home (/me).
// Combines UNREAD in-app notifications (mapped to their tile) with must-act items that persist
// until done (policies awaiting acceptance). Auth-any: an employee sees only their own counts.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const service = createServiceClient();
  const badges: Record<string, number> = {};
  let unreadTotal = 0;

  // 1) Unread in-app notifications → per-tile badge + total.
  const { data: notifs } = await service
    .from('notifications')
    .select('type')
    .eq('user_id', user.id)
    .eq('read', false);
  for (const n of notifs ?? []) {
    unreadTotal++;
    const tile = NOTIF_TILE[(n as { type: string }).type];
    if (tile) badges[tile] = (badges[tile] ?? 0) + 1;
  }

  // 2) Active company policies the employee has not accepted for the current version.
  //    Role-scoped policies (target_roles) only count for the roles they target.
  const [{ data: pols }, { data: acks }, { data: profile }] = await Promise.all([
    service.from('hr_policies').select('id, version, target_roles').eq('active', true),
    service.from('hr_policy_acknowledgements').select('policy_id, policy_version').eq('user_id', user.id),
    service.from('profiles').select('role').eq('id', user.id).maybeSingle(),
  ]);
  const role = (profile as { role?: string } | null)?.role ?? null;
  const ackSet = new Set(
    (acks ?? []).map((a) => `${(a as { policy_id: string }).policy_id}|${(a as { policy_version: number }).policy_version}`)
  );
  const pendingPolicies = (pols ?? [])
    .filter((p) => policyAppliesToRole((p as { target_roles?: string[] | null }).target_roles, role))
    .filter(
      (p) => !ackSet.has(`${(p as { id: string }).id}|${(p as { version: number }).version}`)
    ).length;
  if (pendingPolicies > 0) badges.policies = (badges.policies ?? 0) + pendingPolicies;

  return NextResponse.json({ badges, unread_total: unreadTotal });
}
