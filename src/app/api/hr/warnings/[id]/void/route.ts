import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';

const TABLE = 'hr_warnings';

// POST /api/hr/warnings/[id]/void — HR voids a warning. Body: { reason }. The status
// transition is an atomic compare-and-set (`status <> 'void'`, 0 rows → 409) so a void
// racing a concurrent void can never double-apply. Only company-wide HR may void.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!reason) return NextResponse.json({ error: 'A void reason is required' }, { status: 400 });

  const service = createServiceClient();
  const { data: updated, error } = await service
    .from(TABLE)
    .update({ status: 'void', void_reason: reason, updated_by: auth.userId })
    .eq('id', id)
    .neq('status', 'void')
    .select('id');
  if (error) return NextResponse.json({ error: 'Failed to void warning' }, { status: 500 });
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: 'Warning not found or already voided' }, { status: 409 });
  }

  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'update',
    table: TABLE,
    recordId: id,
    after: { status: 'void', void_reason: reason },
    reason,
  });

  return NextResponse.json({ data: { id, status: 'void' } });
}
