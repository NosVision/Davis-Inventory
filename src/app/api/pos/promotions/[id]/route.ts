import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getPosContext, isPosManager } from '@/lib/pos/guard';

interface PatchBody {
  name?: string;
  percent?: number;
  amountSatang?: number;
  minSpendSatang?: number;
  startsAt?: string | null;
  endsAt?: string | null;
  maxUses?: number | null;
  active?: boolean;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user, role } = await getPosContext();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isPosManager(role)) return NextResponse.json({ error: 'เฉพาะเจ้าของ/ผู้จัดการ' }, { status: 403 });

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const update: Record<string, unknown> = {};
  if (typeof body.name === 'string') update.name = body.name.trim() || null;
  if (typeof body.percent === 'number') update.percent = Math.min(100, Math.max(0, Math.round(body.percent)));
  if (typeof body.amountSatang === 'number') update.amount_satang = Math.max(0, Math.round(body.amountSatang));
  if (typeof body.minSpendSatang === 'number') update.min_spend_satang = Math.max(0, Math.round(body.minSpendSatang));
  if ('startsAt' in body) update.starts_at = body.startsAt || null;
  if ('endsAt' in body) update.ends_at = body.endsAt || null;
  if ('maxUses' in body) update.max_uses = typeof body.maxUses === 'number' && body.maxUses > 0 ? Math.round(body.maxUses) : null;
  if (typeof body.active === 'boolean') update.active = body.active;
  if (Object.keys(update).length === 0) return NextResponse.json({ error: 'ไม่มีข้อมูลที่จะแก้ไข' }, { status: 400 });

  const { data, error } = await supabase.from('pos_promotions').update(update).eq('id', id).select('*').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ promotion: data });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user, role } = await getPosContext();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isPosManager(role)) return NextResponse.json({ error: 'เฉพาะเจ้าของ/ผู้จัดการ' }, { status: 403 });
  const { error } = await supabase.from('pos_promotions').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
