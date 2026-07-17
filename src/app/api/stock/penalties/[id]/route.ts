import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { notifyUser } from '@/lib/notifications/service';

// PATCH /api/stock/penalties/[id] — HQ edits or cancels a stock penalty AFTER it was issued.
// (owner ask 2026-07-17). Money lifecycle is pending → sent_hr → deducted:
//   • pending / sent_hr  → editable (amount / notes) and cancellable. HR re-sums non-cancelled
//     penalties on apply, so an edit here flows through naturally; if it was already sent, HR is
//     re-notified that the list changed.
//   • deducted           → LOCKED. The money already left the SV pool; HR must reverse it on the
//     Service-Charge side first. Returned as 409 so the UI can explain, not silently corrupt money.
// HQ-only (owner / hq / can_manage_stock_sop). See docs/hr/stock-penalty-to-hr.md.

const MANAGE_ROLES = ['owner', 'hq'];

async function requireStockSopManager(): Promise<
  | { ok: true; userId: string; service: ReturnType<typeof createServiceClient> }
  | { ok: false; res: NextResponse }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  const service = createServiceClient();
  const [profileRes, permsRes] = await Promise.all([
    service.from('profiles').select('role').eq('id', user.id).maybeSingle(),
    service.from('user_permissions').select('permission').eq('user_id', user.id),
  ]);
  const role = (profileRes.data as { role?: string } | null)?.role ?? '';
  const perms = (permsRes.data ?? []).map((p) => (p as { permission: string }).permission);
  if (!MANAGE_ROLES.includes(role) && !perms.includes('can_manage_stock_sop')) {
    return { ok: false, res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { ok: true, userId: user.id, service };
}

interface PenaltyRow {
  id: string;
  store_id: string | null;
  staff_id: string | null;
  penalty_code: string | null;
  amount: number | null;
  status: string | null;
  notes: string | null;
  month_year: string | null;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireStockSopManager();
  if (!auth.ok) return auth.res;
  const { service, userId } = auth;
  const { id } = await params;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const { data: penData } = await service.from('penalties').select('*').eq('id', id).maybeSingle();
  const pen = penData as PenaltyRow | null;
  if (!pen) return NextResponse.json({ error: 'ไม่พบรายการค่าปรับ' }, { status: 404 });

  if (pen.status === 'deducted') {
    return NextResponse.json(
      { error: 'รายการนี้ถูกหักจากกอง SV แล้ว — ต้องให้ HR ย้อนรายการในกอง Service Charge ก่อน', code: 'locked_deducted' },
      { status: 409 },
    );
  }
  if (pen.status === 'cancelled') {
    return NextResponse.json({ error: 'รายการนี้ถูกยกเลิกไปแล้ว', code: 'already_cancelled' }, { status: 409 });
  }

  const patch: Record<string, unknown> = {};
  const isCancel = body.action === 'cancel';
  if (isCancel) {
    patch.status = 'cancelled';
  } else {
    if (body.amount !== undefined && body.amount !== null && body.amount !== '') {
      const amt = Number(body.amount);
      if (!Number.isFinite(amt) || amt < 0) {
        return NextResponse.json({ error: 'จำนวนเงินไม่ถูกต้อง' }, { status: 400 });
      }
      patch.amount = amt;
    }
    if (body.notes !== undefined) {
      patch.notes = typeof body.notes === 'string' ? body.notes.trim() || null : null;
    }
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'ไม่มีการเปลี่ยนแปลง' }, { status: 400 });
  }

  const { data: updated, error } = await service
    .from('penalties')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // If it was already sent to HR, the deduction list just changed under them — nudge HR to re-check.
  if (pen.status === 'sent_hr' && pen.store_id) {
    const { data: store } = await service
      .from('stores')
      .select('store_name')
      .eq('id', pen.store_id)
      .maybeSingle();
    const storeName = (store as { store_name?: string } | null)?.store_name ?? '';
    const { data: hrUsers } = await service.from('profiles').select('id').in('role', ['owner', 'hr']);
    const verb = isCancel ? 'ยกเลิก' : 'แก้ไข';
    await Promise.all(
      (hrUsers ?? []).map((u) =>
        notifyUser({
          userId: (u as { id: string }).id,
          storeId: pen.store_id,
          type: 'approval_request',
          title: '✏️ ค่าปรับสต๊อกที่ส่งแล้วถูกแก้ไข',
          body: `${storeName} — HQ ${verb}รายการค่าปรับที่ส่งให้ HR แล้ว โปรดตรวจก่อนหักจากกอง SV`,
          data: { url: '/hr/stock-deductions' },
        }).catch(() => {}),
      ),
    );
  }

  // Audit trail (non-fatal).
  try {
    await service.from('audit_logs').insert({
      store_id: pen.store_id,
      action_type: isCancel ? 'STOCK_PENALTY_CANCELLED' : 'STOCK_PENALTY_EDITED',
      table_name: 'penalties',
      record_id: id,
      old_value: { amount: pen.amount, status: pen.status, notes: pen.notes },
      new_value: patch,
      changed_by: userId,
    });
  } catch {
    // ignore
  }

  return NextResponse.json({ data: updated });
}
