import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

// GET /api/hr/ess/identity — the caller's identity-link status, driving the "ระบุชื่อจริงของคุณ"
// modal (owner flow 2026-07-05): linked = an hr_employees row exists for this profile; claim =
// their pending pick awaiting HR review (name only — never the payroll seed fields).
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const service = createServiceClient();
  const [{ data: emp }, { data: claim }] = await Promise.all([
    service.from('hr_employees').select('id').eq('profile_id', user.id).maybeSingle(),
    service
      .from('hr_pending_identities')
      .select('id, full_name_th, status, claimed_at')
      .eq('claimed_by', user.id)
      .eq('status', 'claimed')
      .maybeSingle(),
  ]);

  return NextResponse.json({
    data: {
      linked: !!emp,
      claim: claim ? { id: claim.id, full_name_th: claim.full_name_th, claimed_at: claim.claimed_at } : null,
    },
  });
}
