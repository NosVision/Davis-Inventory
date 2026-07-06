import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManagerForStore } from '@/lib/hr/route-auth';
import { announcePayrun } from '@/lib/hr/announce';

// POST /api/hr/payruns/[id]/announce { resend? } — ⑤ manual "ประกาศเงินเดือนออก": push the
// payslip-ready notification to everyone in a finalized payrun. Idempotent unless resend.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const service = createServiceClient();

  const { data: pr } = await service.from('hr_payruns').select('store_id').eq('id', id).maybeSingle();
  if (!pr) return NextResponse.json({ error: 'Payrun not found' }, { status: 404 });
  const auth = await requireHrManagerForStore((pr.store_id as string | null) ?? null);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const result = await announcePayrun(service, { payrunId: id, actorId: auth.userId, resend: body.resend === true });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ data: { notified: result.notified } });
}
