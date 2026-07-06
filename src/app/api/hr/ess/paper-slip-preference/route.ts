import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { logHrAudit } from '@/lib/hr/audit';

// PUT /api/hr/ess/paper-slip-preference { standing } — "รับสลิปกระดาษทุกเดือน" standing
// preference on the caller's OWN employee record (④). Every finalized payrun auto-queues
// these people in HR's print queue.
export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const standing = Boolean(body.standing);

  const service = createServiceClient();
  const { data: emp } = await service.from('hr_employees').select('id, paper_slip_standing').eq('profile_id', user.id).maybeSingle();
  if (!emp) return NextResponse.json({ error: 'No employee record' }, { status: 404 });

  const { error } = await service.from('hr_employees').update({ paper_slip_standing: standing }).eq('id', emp.id);
  if (error) return NextResponse.json({ error: 'Failed to update preference' }, { status: 500 });

  await logHrAudit(service, {
    actorId: user.id,
    action: 'update',
    table: 'hr_employees',
    recordId: emp.id as string,
    before: { paper_slip_standing: emp.paper_slip_standing },
    after: { paper_slip_standing: standing },
    reason: 'Self-service paper-slip preference',
  });

  return NextResponse.json({ data: { standing } });
}
