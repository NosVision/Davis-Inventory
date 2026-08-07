import { redirect } from 'next/navigation';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { ApprovalsWorkspace } from './_components/approvals-workspace';

/**
 * Venue approvals — the screen a store manager needs to actually do the job they were given.
 *
 * The leave API has gated on hr_manager_scopes since §P5.5 (store → that store's manager or HR;
 * no store → HR only), and the owner moved approval down to venue managers on 2026-08-07. But
 * every leave screen lives under /hr, which redirects anyone who is not owner/hr/can_manage_hr —
 * so a manager could approve through the API and had nowhere to press the button. This is it.
 *
 * Deliberately outside /hr for that reason, and gated on running a venue rather than on a role:
 * venue management is a per-user grant, so a `manager` who runs nothing gets nothing, and a
 * `head_bar` who does run one gets in.
 */
export default async function ApprovalsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [{ data: profile }, { data: perms }] = await Promise.all([
    supabase.from('profiles').select('role').eq('id', user.id).single(),
    supabase.from('user_permissions').select('permission').eq('user_id', user.id),
  ]);
  const role = (profile?.role as string) ?? '';
  const permissions = (perms ?? []).map((p) => p.permission as string);
  const isHr =
    role === 'owner' || role === 'hr' || permissions.includes('can_manage_hr');

  // Service client: hr_manager_scopes is readable by the owner of the row under RLS, but the
  // store join is not — and HR needs the whole list.
  const service = createServiceClient();
  const { data: scopes } = await service
    .from('hr_manager_scopes')
    .select('store_id, store:stores(id, store_name)')
    .eq('user_id', user.id);

  const stores = (scopes ?? [])
    .map((s) => (Array.isArray(s.store) ? s.store[0] : s.store) as { id: string; store_name: string } | null)
    .filter((s): s is { id: string; store_name: string } => !!s);

  // HR already has the full queue at /hr/leaves; send them there rather than showing a second,
  // narrower copy of the same thing.
  if (stores.length === 0) redirect(isHr ? '/hr/leaves' : '/');

  return <ApprovalsWorkspace stores={stores} />;
}
