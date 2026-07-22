import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { logHrAudit } from '@/lib/hr/audit';

const TABLE = 'hr_resignation_requests';

// POST /api/hr/ess/resignation/[id]/withdraw — the EMPLOYEE withdraws their OWN pending
// resignation request. Atomic compare-and-set (pending → withdrawn); once HR has
// accepted/rejected it (or it was already withdrawn) → 409.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const service = createServiceClient();

  const { data: row, error: loadErr } = await service
    .from(TABLE)
    .select('id, user_id, status')
    .eq('id', id)
    .maybeSingle();
  if (loadErr) return NextResponse.json({ error: 'Failed to load request' }, { status: 500 });
  if (!row) return NextResponse.json({ error: 'Request not found' }, { status: 404 });
  if ((row.user_id as string) !== user.id) {
    return NextResponse.json({ error: 'Forbidden — not your request' }, { status: 403 });
  }

  const { data: updated, error } = await service
    .from(TABLE)
    .update({ status: 'withdrawn' })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id');
  if (error) return NextResponse.json({ error: 'Failed to withdraw request' }, { status: 500 });
  if (!updated || updated.length === 0) {
    return NextResponse.json(
      { error: 'Only a pending request can be withdrawn' },
      { status: 409 }
    );
  }

  await logHrAudit(service, {
    actorId: user.id,
    action: 'update',
    table: TABLE,
    recordId: id,
    before: { status: 'pending' },
    after: { status: 'withdrawn' },
    reason: 'Resignation request withdrawn by employee',
  });

  return NextResponse.json({ data: { id, status: 'withdrawn' } });
}
