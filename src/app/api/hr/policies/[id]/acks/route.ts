import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';
import { attachFullNames } from '@/lib/hr/employee-name-map';

// GET /api/hr/policies/[id]/acks — acknowledgements for a policy, joined to the acknowledger
// (ชื่อจริง from hr_employees + ชื่อเล่น from profiles), newest first. An acknowledgement is a
// signed record, so it has to name the person the way the rest of their HR file does.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const service = createServiceClient();
  const { data, error } = await service
    .from('hr_policy_acknowledgements')
    .select(
      'id, policy_version, acked_at, signature_path, user:profiles!hr_policy_acknowledgements_user_id_fkey(id, display_name, username)'
    )
    .eq('policy_id', id)
    .order('acked_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: await attachFullNames(service, data ?? []) });
}
