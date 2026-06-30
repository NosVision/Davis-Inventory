import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { recomputeOrderTotals } from '@/lib/pos/orders';

// GET /api/pos/orders/[id] — รายละเอียดบิล + รายการ + การชำระเงิน
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: order, error } = await supabase.from('pos_orders').select('*').eq('id', id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!order) return NextResponse.json({ error: 'ไม่พบบิล' }, { status: 404 });

  const [{ data: items }, { data: payments }] = await Promise.all([
    supabase.from('pos_order_items').select('*').eq('order_id', id).order('created_at'),
    supabase.from('pos_payments').select('*').eq('order_id', id).order('created_at'),
  ]);

  return NextResponse.json({ order, items: items ?? [], payments: payments ?? [] });
}

interface PatchBody {
  note?: string;
  discountSatang?: number;
  tableId?: string | null;
}

// PATCH /api/pos/orders/[id] — แก้โน้ต/ส่วนลด/ย้ายโต๊ะ (table = pointer)
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if (typeof body.note === 'string') update.note = body.note.trim() || null;
  if (typeof body.discountSatang === 'number') update.discount_satang = Math.max(0, Math.round(body.discountSatang));
  if ('tableId' in body) update.table_id = body.tableId ?? null;

  if (Object.keys(update).length > 0) {
    const { error } = await supabase.from('pos_orders').update(update).eq('id', id).eq('status', 'open');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const totals = await recomputeOrderTotals(id);
  const { data: order } = await supabase.from('pos_orders').select('*').eq('id', id).single();
  return NextResponse.json({ order, totals });
}
