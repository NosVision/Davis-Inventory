import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getInvContext, isInvMgmt } from '@/lib/inventory/guard';

interface PatchBody {
  name?: string;
  phone?: string;
  contact?: string;
  note?: string;
  active?: boolean;
}

// PATCH /api/inventory/suppliers/[id] — แก้ไขซัพพลายเออร์
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user, role } = await getInvContext();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isInvMgmt(role)) return NextResponse.json({ error: 'เฉพาะเจ้าของ/ผู้จัดการ/บัญชี' }, { status: 403 });

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if (typeof body.name === 'string') update.name = body.name.trim();
  if (typeof body.phone === 'string') update.phone = body.phone.trim() || null;
  if (typeof body.contact === 'string') update.contact = body.contact.trim() || null;
  if (typeof body.note === 'string') update.note = body.note.trim() || null;
  if (typeof body.active === 'boolean') update.active = body.active;
  if (Object.keys(update).length === 0) return NextResponse.json({ error: 'ไม่มีข้อมูลที่จะแก้ไข' }, { status: 400 });

  const { data, error } = await supabase.from('inv_suppliers').update(update).eq('id', id).select('*').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ supplier: data });
}
