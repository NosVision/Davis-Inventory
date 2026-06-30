import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getPosContext, isPosManager } from '@/lib/pos/guard';

const KINDS = ['percent', 'amount'];

// GET /api/pos/promotions?storeId=
export async function GET(request: NextRequest) {
  const { supabase, user } = await getPosContext();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const storeId = request.nextUrl.searchParams.get('storeId');
  if (!storeId) return NextResponse.json({ error: 'ต้องระบุสาขา' }, { status: 400 });
  const { data, error } = await supabase.from('pos_promotions').select('*').eq('store_id', storeId).order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ promotions: data ?? [] });
}

interface CreateBody {
  storeId?: string;
  code?: string;
  name?: string;
  kind?: string;
  percent?: number;
  amountSatang?: number;
  minSpendSatang?: number;
  startsAt?: string | null;
  endsAt?: string | null;
  maxUses?: number | null;
}

// POST /api/pos/promotions — เพิ่มโปรโมชั่น
export async function POST(request: NextRequest) {
  const { supabase, user, role } = await getPosContext();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isPosManager(role)) return NextResponse.json({ error: 'เฉพาะเจ้าของ/ผู้จัดการ' }, { status: 403 });

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  if (!body.storeId || !body.code?.trim()) return NextResponse.json({ error: 'ต้องระบุสาขาและโค้ด' }, { status: 400 });
  const kind = KINDS.includes(body.kind ?? '') ? body.kind : 'percent';

  const { data, error } = await supabase
    .from('pos_promotions')
    .insert({
      store_id: body.storeId,
      code: body.code.trim().toUpperCase(),
      name: body.name?.trim() || null,
      kind,
      percent: kind === 'percent' ? Math.min(100, Math.max(0, Math.round(body.percent ?? 0))) : null,
      amount_satang: kind === 'amount' ? Math.max(0, Math.round(body.amountSatang ?? 0)) : null,
      min_spend_satang: Math.max(0, Math.round(body.minSpendSatang ?? 0)),
      starts_at: body.startsAt || null,
      ends_at: body.endsAt || null,
      max_uses: typeof body.maxUses === 'number' && body.maxUses > 0 ? Math.round(body.maxUses) : null,
    })
    .select('*')
    .single();
  if (error) {
    if ((error as { code?: string }).code === '23505') return NextResponse.json({ error: 'โค้ดนี้มีอยู่แล้ว' }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ promotion: data });
}
