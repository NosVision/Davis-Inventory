import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * ใบ 50 ทวิ (withholding-tax certificates) that AEs ask for, tracked per month.
 *
 * A row means "this AE asked for their certificate for this month"; `status` flips to 'issued'
 * once the accountant hands it over. Keyed by (store, ae, month) so the monthly report can just
 * tick a box — no separate request workflow to maintain.
 */

const TABLE = 'commission_wht_certs';

// GET /api/commission/wht-certs?month=2026-08&store_id=…
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const month = req.nextUrl.searchParams.get('month');
  const storeId = req.nextUrl.searchParams.get('store_id');
  if (!month) return NextResponse.json({ error: 'month parameter required (YYYY-MM)' }, { status: 400 });

  let query = supabase.from(TABLE).select('*').eq('month', month);
  if (storeId) query = query.eq('store_id', storeId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

// POST /api/commission/wht-certs — { store_id, ae_id, month, status?, note? }
// Upsert on (store, ae, month): first call records the request, later calls flip status/note.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { store_id, ae_id, month, status, note } = body as {
    store_id?: string; ae_id?: string; month?: string; status?: string; note?: string | null;
  };
  if (!store_id || !ae_id || !month) {
    return NextResponse.json({ error: 'store_id, ae_id, month required' }, { status: 400 });
  }
  if (status && status !== 'requested' && status !== 'issued') {
    return NextResponse.json({ error: 'invalid status' }, { status: 400 });
  }

  const isIssued = status === 'issued';
  const { data, error } = await supabase
    .from(TABLE)
    .upsert(
      {
        store_id,
        ae_id,
        month,
        status: status ?? 'requested',
        note: typeof note === 'string' ? note.trim() || null : null,
        requested_by: user.id,
        // Stamped only on the way to 'issued'; reverting to 'requested' clears it so the two
        // fields can never disagree.
        issued_by: isIssued ? user.id : null,
        issued_at: isIssued ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'store_id,ae_id,month' },
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// DELETE /api/commission/wht-certs?ae_id=…&month=…&store_id=… — the AE no longer wants one.
export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const p = req.nextUrl.searchParams;
  const [storeId, aeId, month] = [p.get('store_id'), p.get('ae_id'), p.get('month')];
  if (!storeId || !aeId || !month) {
    return NextResponse.json({ error: 'store_id, ae_id, month required' }, { status: 400 });
  }

  const { error } = await supabase
    .from(TABLE)
    .delete()
    .eq('store_id', storeId)
    .eq('ae_id', aeId)
    .eq('month', month);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
