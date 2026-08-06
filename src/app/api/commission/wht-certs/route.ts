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

// Both actor FKs point at profiles, so each embed is disambiguated by its column name. Writes
// return the same shape as GET so the report never has to re-fetch to show who ticked the row.
const SELECT_WITH_ACTORS =
  '*, requester:profiles!requested_by(display_name, username), issuer:profiles!issued_by(display_name, username)';

// GET /api/commission/wht-certs?month=2026-08&store_id=…
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const month = req.nextUrl.searchParams.get('month');
  const storeId = req.nextUrl.searchParams.get('store_id');
  if (!month) return NextResponse.json({ error: 'month parameter required (YYYY-MM)' }, { status: 400 });

  let query = supabase.from(TABLE).select(SELECT_WITH_ACTORS).eq('month', month);
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

  // Read-then-write rather than a blind upsert: an upsert re-sends every column, which used to
  // overwrite requested_by with whoever flipped the row to 'issued' (losing who actually asked)
  // and wipe the note on any status change. Only the fields in this call are touched now.
  const { data: existing } = await supabase
    .from(TABLE)
    .select('id, status, note')
    .eq('store_id', store_id)
    .eq('ae_id', ae_id)
    .eq('month', month)
    .maybeSingle();

  const nextStatus = status ?? existing?.status ?? 'requested';
  const isIssued = nextStatus === 'issued';
  // note omitted → keep what is there; note given → trim, and an empty string clears it.
  const nextNote = note === undefined ? (existing?.note ?? null) : (note?.trim() || null);

  const stamps = {
    status: nextStatus,
    note: nextNote,
    // Stamped only on the way to 'issued'; reverting to 'requested' clears it so the two
    // fields can never disagree.
    issued_by: isIssued ? user.id : null,
    issued_at: isIssued ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = existing
    ? await supabase.from(TABLE).update(stamps).eq('id', existing.id).select(SELECT_WITH_ACTORS).single()
    : await supabase
        .from(TABLE)
        .insert({ store_id, ae_id, month, requested_by: user.id, ...stamps })
        .select(SELECT_WITH_ACTORS)
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
