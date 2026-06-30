import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getInvContext, isInvMgmt } from '@/lib/inventory/guard';
import type { InvKind } from '@/types/inventory';

const KINDS: InvKind[] = ['drink', 'food', 'other'];

interface PatchBody {
  name?: string;
  category?: string;
  unit?: string;
  kind?: InvKind;
  active?: boolean;
}

// PATCH /api/inventory/products/[id] — แก้สินค้าใน master / เปิด-ปิดใช้งาน
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user, role } = await getInvContext();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isInvMgmt(role)) {
    return NextResponse.json({ error: 'เฉพาะเจ้าของ/ผู้จัดการ/บัญชี' }, { status: 403 });
  }

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if (typeof body.name === 'string') update.name = body.name.trim();
  if (typeof body.category === 'string') update.category = body.category.trim() || null;
  if (typeof body.unit === 'string') update.unit = body.unit.trim() || null;
  if (KINDS.includes(body.kind as InvKind)) update.kind = body.kind;
  if (typeof body.active === 'boolean') update.active = body.active;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'ไม่มีข้อมูลที่จะแก้ไข' }, { status: 400 });
  }

  const { data, error } = await supabase.from('inv_products').update(update).eq('id', id).select('*').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ product: data });
}
