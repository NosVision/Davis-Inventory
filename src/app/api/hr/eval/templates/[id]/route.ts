import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';

const TABLE = 'hr_eval_assignment_templates';

// DELETE /api/hr/eval/templates/[id] — remove a saved assignment template (§Phase 4). HR-only.
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;

  const service = createServiceClient();
  const { data: before } = await service.from(TABLE).select('id, store_id, name').eq('id', id).maybeSingle();
  if (!before) return NextResponse.json({ error: 'Template not found' }, { status: 404 });

  const { error } = await service.from(TABLE).delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logHrAudit(service, {
    actorId: auth.userId, action: 'delete', table: TABLE, recordId: id,
    before, after: null, reason: 'eval assignment template removed',
  });
  return NextResponse.json({ data: { id, removed: true } });
}
