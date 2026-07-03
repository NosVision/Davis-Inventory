import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';

const POOLS = 'hr_sc_pools';
const ALLOCS = 'hr_sc_allocations';

interface AllocInput {
  user_id: string;
  allocated_satang: number;
}

function isNonNegInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

// PUT /api/hr/service-charge/[poolId]/allocations — set per-person SC allocations for a pool
// (§H). Bulk upsert on (pool_id, user_id). A finalized pool is locked.
export async function PUT(request: NextRequest, { params }: { params: Promise<{ poolId: string }> }) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { poolId } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const rawAllocations = Array.isArray(body.allocations) ? body.allocations : null;
  if (!rawAllocations) {
    return NextResponse.json({ error: 'allocations must be an array' }, { status: 400 });
  }

  const allocations: AllocInput[] = [];
  for (const item of rawAllocations) {
    const a = item as Record<string, unknown>;
    const userId = typeof a.user_id === 'string' ? a.user_id : '';
    if (!userId || !isNonNegInt(a.allocated_satang)) {
      return NextResponse.json(
        { error: 'each allocation needs a user_id and a non-negative integer allocated_satang' },
        { status: 400 },
      );
    }
    allocations.push({ user_id: userId, allocated_satang: a.allocated_satang });
  }

  const service = createServiceClient();

  const { data: pool, error: poolErr } = await service
    .from(POOLS)
    .select('id, status')
    .eq('id', poolId)
    .maybeSingle();
  if (poolErr) return NextResponse.json({ error: poolErr.message }, { status: 500 });
  if (!pool) return NextResponse.json({ error: 'Pool not found' }, { status: 404 });
  if (pool.status === 'finalized') {
    return NextResponse.json({ error: 'pool is finalized' }, { status: 409 });
  }

  const rows = allocations.map((a) => ({
    pool_id: poolId,
    user_id: a.user_id,
    allocated_satang: a.allocated_satang,
    updated_by: auth.userId,
  }));

  const { data, error } = await service
    .from(ALLOCS)
    .upsert(rows, { onConflict: 'pool_id,user_id' })
    .select('*');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'update',
    table: ALLOCS,
    recordId: poolId,
    before: null,
    after: { pool_id: poolId, allocations },
  });

  return NextResponse.json({ data: data ?? [] });
}
