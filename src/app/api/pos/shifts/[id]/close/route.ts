import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { computeShiftSales } from '@/lib/pos/shift-report';

// POST /api/pos/shifts/[id]/close — ปิดกะ + คำนวณเงินคาด/ส่วนต่าง
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { closingCashSatang?: number; note?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const { data: shiftRow } = await supabase.from('pos_shifts').select('*').eq('id', id).maybeSingle();
  const shift = shiftRow as { status: string; opening_cash_satang: number } | null;
  if (!shift) return NextResponse.json({ error: 'ไม่พบกะ' }, { status: 404 });
  if (shift.status !== 'open') return NextResponse.json({ error: 'กะนี้ปิดแล้ว' }, { status: 400 });

  const report = await computeShiftSales(id);
  const expected = shift.opening_cash_satang + report.cashSatang;

  const { data: updated, error } = await supabase
    .from('pos_shifts')
    .update({
      status: 'closed',
      closed_by: user.id,
      closed_at: new Date().toISOString(),
      closing_cash_satang: typeof body.closingCashSatang === 'number' ? Math.round(body.closingCashSatang) : null,
      expected_cash_satang: expected,
      note: body.note?.trim() || null,
    })
    .eq('id', id)
    .eq('status', 'open')
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ shift: updated, report });
}
