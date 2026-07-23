import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET /api/commission — list commission entries with filters
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const storeId = req.nextUrl.searchParams.get('store_id');
  const type = req.nextUrl.searchParams.get('type');
  const aeId = req.nextUrl.searchParams.get('ae_id');
  const month = req.nextUrl.searchParams.get('month'); // YYYY-MM
  const limit = parseInt(req.nextUrl.searchParams.get('limit') || '100');
  const offset = parseInt(req.nextUrl.searchParams.get('offset') || '0');

  let query = supabase
    .from('commission_entries')
    .select('*, ae_profile:ae_profiles(*), staff_profile:profiles!commission_entries_staff_id_fkey(id, display_name, username, role), store:stores!commission_entries_store_id_fkey(id, store_name, store_code)', { count: 'exact' })
    .order('bill_date', { ascending: false })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (storeId) query = query.eq('store_id', storeId);
  if (type) query = query.eq('type', type);
  if (aeId) query = query.eq('ae_id', aeId);
  if (month) {
    const start = `${month}-01`;
    const [y, m] = month.split('-').map(Number);
    const end = new Date(y, m, 0).toISOString().split('T')[0]; // last day of month
    query = query.gte('bill_date', start).lte('bill_date', end);
  }

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data, count });
}

// POST /api/commission — create commission entry
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { store_id, type, ae_id, staff_id, bill_date, receipt_no, receipt_photo_url, table_no, subtotal_amount, commission_rate, tax_rate, bottle_count, bottle_rate, bottle_product_id, bottle_product_name, bottle_product_category, notes } = body;

  if (!store_id || !type || !bill_date) {
    return NextResponse.json({ error: 'store_id, type, bill_date จำเป็นต้องกรอก' }, { status: 400 });
  }

  // Normalize the receipt/invoice number once — it's the key we use to
  // block duplicate bills within the same store. Uppercased because the number
  // is hand-typed: "Rc6907090027" vs "RC6907090027" slipped past the guard as
  // two different bills (client report 2026-07-23).
  const receiptNo: string | null = receipt_no?.trim().toUpperCase() || null;

  // Net is stored EXACTLY as computed, to the satang (client ask 2026-07-21 — reversing
  // the 2026-07-09 always-round rule). The whole-baht view is now a display-time toggle
  // on the commission page; nothing is rounded at save.

  // Duplicate guard (fast path, per store). Reject early with a friendly
  // message if this invoice number already exists on an active
  // (non-cancelled) bill at the SAME store. Receipt numbers legitimately
  // collide across branches, so we scope to store_id — matching the
  // per-store partial unique index (migration 00131), which is the
  // authoritative guard handled below via the 23505 fallback.
  if (receiptNo) {
    // ilike (with LIKE wildcards escaped) = case-insensitive equality, so legacy
    // rows saved before uppercasing ("Rc...") still block a re-entry ("RC...").
    const likePattern = receiptNo.replace(/[\\%_]/g, (m) => `\\${m}`);
    const { data: dup } = await supabase
      .from('commission_entries')
      .select('id')
      .eq('store_id', store_id)
      .ilike('receipt_no', likePattern)
      .is('cancelled_at', null)
      .limit(1)
      .maybeSingle();
    if (dup) {
      return NextResponse.json(
        { error: `บิลเลขที่ ${receiptNo} ถูกบันทึกในสาขานี้ไปแล้ว — ห้ามใส่บิลซ้ำ` },
        { status: 409 }
      );
    }
  }

  let commission_amount: number | null = null;
  let tax_amount: number | null = null;
  let net_amount: number;

  if (type === 'ae_commission') {
    if (!ae_id) return NextResponse.json({ error: 'กรุณาเลือก AE' }, { status: 400 });
    if (!subtotal_amount || subtotal_amount <= 0) return NextResponse.json({ error: 'กรุณากรอกยอดรวม' }, { status: 400 });

    const rate = commission_rate ?? 0.10;
    const tRate = tax_rate ?? 0.03;
    commission_amount = Math.round(subtotal_amount * rate * 100) / 100;
    tax_amount = Math.round(commission_amount * tRate * 100) / 100;
    // Exact net (satang precision) — only float dust is trimmed, never whole-baht rounded.
    net_amount = Math.round((commission_amount - tax_amount) * 100) / 100;
  } else {
    // bottle_commission
    const count = bottle_count ?? 1;
    const rate = bottle_rate ?? 500;
    net_amount = Math.round(count * rate * 100) / 100;
  }

  const { data, error } = await supabase
    .from('commission_entries')
    .insert({
      store_id,
      type,
      ae_id: type === 'ae_commission' ? ae_id : null,
      staff_id: type === 'bottle_commission' ? (staff_id || null) : null,
      bill_date,
      receipt_no: receiptNo,
      receipt_photo_url: receipt_photo_url || null,
      table_no: table_no?.trim() || null,
      subtotal_amount: type === 'ae_commission' ? subtotal_amount : null,
      commission_rate: commission_rate ?? 0.10,
      tax_rate: tax_rate ?? 0.03,
      commission_amount,
      tax_amount,
      net_amount,
      rounding: null,
      bottle_count: type === 'bottle_commission' ? (bottle_count ?? 1) : null,
      bottle_rate: type === 'bottle_commission' ? (bottle_rate ?? 500) : null,
      bottle_product_id: type === 'bottle_commission' ? (bottle_product_id || null) : null,
      bottle_product_name: type === 'bottle_commission' ? (bottle_product_name?.trim() || null) : null,
      bottle_product_category: type === 'bottle_commission' ? (bottle_product_category?.trim() || null) : null,
      notes: notes?.trim() || null,
      created_by: user.id,
    })
    .select('*, ae_profile:ae_profiles(*), staff_profile:profiles!commission_entries_staff_id_fkey(id, display_name, username, role), store:stores!commission_entries_store_id_fkey(id, store_name, store_code)')
    .single();

  if (error) {
    // Unique-violation on the per-store receipt_no partial index
    // (migration 00131) — authoritative duplicate guard, covers races the
    // fast-path check can miss. Translate to the same friendly message.
    if (error.code === '23505' && receiptNo) {
      return NextResponse.json(
        { error: `บิลเลขที่ ${receiptNo} ถูกบันทึกในสาขานี้ไปแล้ว — ห้ามใส่บิลซ้ำ` },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
