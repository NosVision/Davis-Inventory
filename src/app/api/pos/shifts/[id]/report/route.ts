import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { computeShiftSales } from '@/lib/pos/shift-report';

// GET /api/pos/shifts/[id]/report — Z-report ของกะ
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: shift } = await supabase.from('pos_shifts').select('*').eq('id', id).maybeSingle();
  if (!shift) return NextResponse.json({ error: 'ไม่พบกะ' }, { status: 404 });
  const report = await computeShiftSales(id);
  return NextResponse.json({ shift, report });
}
