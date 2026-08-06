import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireCancelReason } from '@/lib/commission/cancel-reason';

// GET /api/commission/payment/[id] — get payment detail with entries
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: payment, error } = await supabase
    .from('commission_payments')
    .select('*, ae_profile:ae_profiles(id, name, nickname, bank_name, bank_account_no, bank_account_name), staff_profile:profiles!commission_payments_staff_id_fkey(id, display_name, username), paid_by_profile:profiles!commission_payments_paid_by_fkey(id, display_name, username)')
    .eq('id', id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });

  // The bills this round covered. A CANCELLED payment has already released its entries
  // (payment_id nulled so they can be paid again), so fall back to the id snapshot taken at
  // creation — the round stays inspectable either way.
  const snapshot = (payment as { entry_ids?: string[] | null }).entry_ids ?? null;
  const entriesQuery = supabase.from('commission_entries').select('*').order('bill_date', { ascending: true });
  const { data: entries } = snapshot?.length
    ? await entriesQuery.or(`payment_id.eq.${id},id.in.(${snapshot.join(',')})`)
    : await entriesQuery.eq('payment_id', id);

  return NextResponse.json({ ...payment, entries: entries || [] });
}

// PUT /api/commission/payment/[id] — cancel payment
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();

  if (body.action === 'cancel') {
    // Voiding a payout must say why (2026-08-06) — validated before the update so a reason-less
    // request can never unlink the entries.
    const checked = requireCancelReason(body.reason);
    if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });

    // Cancel payment — reset entries payment_id
    const { error: payErr } = await supabase
      .from('commission_payments')
      .update({
        status: 'cancelled',
        cancelled_by: user.id,
        cancelled_at: new Date().toISOString(),
        cancel_reason: checked.reason,
      })
      .eq('id', id)
      .eq('status', 'paid');

    if (payErr) return NextResponse.json({ error: payErr.message }, { status: 500 });

    // Remove payment_id from entries
    const { error: entryErr } = await supabase
      .from('commission_entries')
      .update({ payment_id: null })
      .eq('payment_id', id);

    if (entryErr) return NextResponse.json({ error: entryErr.message }, { status: 500 });

    return NextResponse.json({ success: true });
  }

  if (body.action === 'add_slips') {
    // Append more transfer slips to an existing payment — used when a
    // payout is settled over several transfer rounds after the fact.
    const incoming: string[] = (Array.isArray(body.slip_photo_urls) ? body.slip_photo_urls : [])
      .filter((u: unknown): u is string => typeof u === 'string' && u.trim().length > 0);
    if (incoming.length === 0) {
      return NextResponse.json({ error: 'ไม่มีสลิปที่จะเพิ่ม' }, { status: 400 });
    }

    const { data: existing, error: fetchErr } = await supabase
      .from('commission_payments')
      .select('slip_photo_urls, slip_photo_url, status')
      .eq('id', id)
      .single();
    if (fetchErr || !existing) {
      return NextResponse.json({ error: 'ไม่พบรายการจ่าย' }, { status: 404 });
    }
    if (existing.status !== 'paid') {
      return NextResponse.json({ error: 'รายการนี้ถูกยกเลิกแล้ว เพิ่มสลิปไม่ได้' }, { status: 400 });
    }

    const current: string[] = existing.slip_photo_urls
      ?? (existing.slip_photo_url ? [existing.slip_photo_url] : []);
    const merged = Array.from(new Set([...current, ...incoming]));

    const { error: updErr } = await supabase
      .from('commission_payments')
      .update({ slip_photo_urls: merged, slip_photo_url: merged[0] ?? null })
      .eq('id', id);
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

    return NextResponse.json({ success: true, slip_photo_urls: merged });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
