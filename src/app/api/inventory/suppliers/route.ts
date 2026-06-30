import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getInvContext, isInvMgmt } from '@/lib/inventory/guard';

// GET /api/inventory/suppliers — รายชื่อซัพพลายเออร์
export async function GET(request: NextRequest) {
  const { supabase, user } = await getInvContext();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let q = supabase.from('inv_suppliers').select('*').order('name');
  if (request.nextUrl.searchParams.get('active') === '1') q = q.eq('active', true);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ suppliers: data ?? [] });
}

interface CreateBody {
  name?: string;
  phone?: string;
  contact?: string;
  note?: string;
}

// POST /api/inventory/suppliers — เพิ่มซัพพลายเออร์ (ฝ่ายจัดการ)
export async function POST(request: NextRequest) {
  const { supabase, user, role } = await getInvContext();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isInvMgmt(role)) return NextResponse.json({ error: 'เฉพาะเจ้าของ/ผู้จัดการ/บัญชี' }, { status: 403 });

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  if (!body.name?.trim()) return NextResponse.json({ error: 'ต้องระบุชื่อซัพพลายเออร์' }, { status: 400 });

  const { data, error } = await supabase
    .from('inv_suppliers')
    .insert({
      name: body.name.trim(),
      phone: body.phone?.trim() || null,
      contact: body.contact?.trim() || null,
      note: body.note?.trim() || null,
    })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ supplier: data });
}
