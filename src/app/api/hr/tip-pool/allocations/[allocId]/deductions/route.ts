import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';

const POOLS = 'hr_tip_pools';
const ALLOCS = 'hr_tip_allocations';
const DEDUCTIONS = 'hr_tip_deductions';

function isNonNegInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

// POST /api/hr/tip-pool/allocations/[allocId]/deductions — add a manual deduction line to a
// person's tip allocation. A finalized pool is locked.
export async function POST(request: NextRequest, { params }: { params: Promise<{ allocId: string }> }) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { allocId } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const label = typeof body.label === 'string' ? body.label.trim() : '';
  const note = typeof body.note === 'string' ? body.note.slice(0, 500) : null;

  if (!label) {
    return NextResponse.json({ error: 'label is required' }, { status: 400 });
  }
  if (!isNonNegInt(body.amount_satang)) {
    return NextResponse.json({ error: 'amount_satang must be a non-negative integer' }, { status: 400 });
  }
  const amountSatang = body.amount_satang;

  const service = createServiceClient();

  const { data: alloc, error: allocErr } = await service
    .from(ALLOCS)
    .select('id, pool_id')
    .eq('id', allocId)
    .maybeSingle();
  if (allocErr) return NextResponse.json({ error: allocErr.message }, { status: 500 });
  if (!alloc) return NextResponse.json({ error: 'Allocation not found' }, { status: 404 });

  const { data: pool, error: poolErr } = await service
    .from(POOLS)
    .select('id, status')
    .eq('id', alloc.pool_id)
    .maybeSingle();
  if (poolErr) return NextResponse.json({ error: poolErr.message }, { status: 500 });
  if (pool && pool.status === 'finalized') {
    return NextResponse.json({ error: 'pool is finalized' }, { status: 409 });
  }

  const { data, error } = await service
    .from(DEDUCTIONS)
    .insert({
      allocation_id: allocId,
      source_type: 'manual',
      label,
      amount_satang: amountSatang,
      note,
      auto: false,
      created_by: auth.userId,
    })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'create',
    table: DEDUCTIONS,
    recordId: data.id as string,
    before: null,
    after: data,
  });

  return NextResponse.json({ data }, { status: 201 });
}
