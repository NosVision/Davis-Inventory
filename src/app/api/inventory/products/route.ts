import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getInvContext, isInvMgmt } from '@/lib/inventory/guard';
import type { InvKind } from '@/types/inventory';

const KINDS: InvKind[] = ['drink', 'food', 'other'];

// GET /api/inventory/products?search=&kind=&active=1 — แคตตาล็อก master (HQ)
export async function GET(request: NextRequest) {
  const { supabase, user } = await getInvContext();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sp = request.nextUrl.searchParams;
  let q = supabase.from('inv_products').select('*').order('name').limit(500);

  const search = sp.get('search')?.trim();
  if (search) {
    const s = search.replace(/[%,]/g, '');
    q = q.or(`name.ilike.%${s}%,sku.ilike.%${s}%`);
  }
  const kind = sp.get('kind');
  if (kind && KINDS.includes(kind as InvKind)) q = q.eq('kind', kind);
  if (sp.get('active') === '1') q = q.eq('active', true);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ products: data ?? [] });
}

interface CreateBody {
  sku?: string;
  name?: string;
  category?: string;
  unit?: string;
  kind?: InvKind;
}

// POST /api/inventory/products — เพิ่มสินค้าใน master (เจ้าของ/ผู้จัดการ/บัญชี)
export async function POST(request: NextRequest) {
  const { supabase, user, role } = await getInvContext();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isInvMgmt(role)) {
    return NextResponse.json({ error: 'เฉพาะเจ้าของ/ผู้จัดการ/บัญชี' }, { status: 403 });
  }

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const sku = body.sku?.trim();
  const name = body.name?.trim();
  if (!sku || !name) return NextResponse.json({ error: 'ต้องระบุรหัส (SKU) และชื่อสินค้า' }, { status: 400 });
  const kind: InvKind = KINDS.includes(body.kind as InvKind) ? (body.kind as InvKind) : 'other';

  const { data, error } = await supabase
    .from('inv_products')
    .insert({
      sku,
      name,
      category: body.category?.trim() || null,
      unit: body.unit?.trim() || null,
      kind,
      created_by: user.id,
    })
    .select('*')
    .single();

  if (error) {
    if ((error as { code?: string }).code === '23505') {
      return NextResponse.json({ error: `รหัส SKU "${sku}" ซ้ำกับสินค้าที่มีอยู่` }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ product: data });
}
