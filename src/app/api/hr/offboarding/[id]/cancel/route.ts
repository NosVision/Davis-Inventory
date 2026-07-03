import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';

const TABLE = 'hr_offboarding';

// POST /api/hr/offboarding/[id]/cancel — abandon an in-progress offboarding. An atomic
// compare-and-set (status IN draft|pending_signoff → cancelled); 0 rows → 409 so a
// completed/already-cancelled record is never reopened.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const service = createServiceClient();

  const { data: updated, error } = await service
    .from(TABLE)
    .update({ status: 'cancelled', updated_by: auth.userId })
    .eq('id', id)
    .in('status', ['draft', 'pending_signoff'])
    .select('id');
  if (error) return NextResponse.json({ error: 'Failed to cancel offboarding' }, { status: 500 });
  if (!updated || updated.length === 0) {
    return NextResponse.json(
      { error: 'Only a draft or pending offboarding can be cancelled' },
      { status: 409 }
    );
  }

  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'update',
    table: TABLE,
    recordId: id,
    after: { status: 'cancelled' },
    reason: 'Offboarding cancelled',
  });

  return NextResponse.json({ data: { id, status: 'cancelled' } });
}
