import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';

// POST /api/hr/payruns/[id]/finalize — lock a draft payrun (§A: payrun locks after finalize;
// editing requires reopen). HR only, atomic compare-and-set on status='draft' → 409 otherwise.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const service = createServiceClient();

  const { data: updated, error } = await service
    .from('hr_payruns')
    .update({ status: 'finalized', finalized_by: auth.userId, finalized_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'draft')
    .select('id');
  if (error) return NextResponse.json({ error: 'Failed to finalize payrun' }, { status: 500 });
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: 'Payrun not found or already finalized' }, { status: 409 });
  }

  await logHrAudit(service, {
    actorId: auth.userId, action: 'update', table: 'hr_payruns', recordId: id,
    before: { status: 'draft' }, after: { status: 'finalized' }, reason: 'payrun finalized',
  });

  return NextResponse.json({ data: { id, status: 'finalized' } });
}
