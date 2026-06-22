import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { notifyStoreStaff } from '@/lib/notifications/service';
import { notifyUserWithLine } from '@/lib/repairs/notify';
import type { RepairRequest, RepairStatus } from '@/types/database';

type Action =
  | 'start'
  | 'complete'
  | 'request_purchase'
  | 'approve_purchase'
  | 'reject_purchase'
  | 'cancel';

interface PatchBody {
  action: Action;
  afterPhotoUrls?: string[];
  estimatedCost?: number;
  purchaseNote?: string;
  ownerNote?: string;
  note?: string;
}

const ADMIN_ROLES = ['owner', 'accountant'];
const TECH_ROLES = ['technician', 'manager', 'owner', 'accountant'];

function cleanUrls(input: unknown): string[] {
  return Array.isArray(input)
    ? input.filter((u): u is string => typeof u === 'string' && u.length > 0)
    : [];
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, display_name')
    .eq('id', user.id)
    .single();
  const role = profile?.role ?? '';
  const actorName = profile?.display_name || 'ผู้ใช้';

  // RLS guarantees the user can only read repairs within their stores.
  const { data: repair, error: fetchErr } = await supabase
    .from('repair_requests')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!repair) {
    return NextResponse.json({ error: 'ไม่พบใบแจ้งซ่อม' }, { status: 404 });
  }

  const r = repair as RepairRequest;
  const isAdmin = ADMIN_ROLES.includes(role);
  const isTech = TECH_ROLES.includes(role);
  const nowIso = new Date().toISOString();

  let update: Partial<RepairRequest> = {};
  let allowed = false;

  switch (body.action) {
    case 'start': {
      allowed = (isTech || isAdmin) && r.status === 'pending';
      update = { status: 'in_progress', assigned_to: user.id };
      break;
    }
    case 'complete': {
      const photos = cleanUrls(body.afterPhotoUrls);
      if (photos.length === 0) {
        return NextResponse.json({ error: 'กรุณาแนบรูปหลังซ่อมอย่างน้อย 1 รูป' }, { status: 400 });
      }
      allowed =
        (isTech || isAdmin) &&
        (['pending', 'in_progress', 'approved'] as RepairStatus[]).includes(r.status);
      update = {
        status: 'completed',
        resolution: r.resolution ?? 'repairable',
        after_photo_urls: photos,
        completed_by: user.id,
        completed_at: nowIso,
      };
      break;
    }
    case 'request_purchase': {
      allowed =
        (isTech || isAdmin) &&
        (['pending', 'in_progress'] as RepairStatus[]).includes(r.status);
      update = {
        status: 'awaiting_approval',
        resolution: 'needs_purchase',
        approval_status: 'pending',
        estimated_cost:
          typeof body.estimatedCost === 'number' && Number.isFinite(body.estimatedCost)
            ? body.estimatedCost
            : null,
        purchase_note: body.purchaseNote?.trim() || null,
        assigned_to: r.assigned_to ?? user.id,
      };
      break;
    }
    case 'approve_purchase': {
      allowed = isAdmin && r.status === 'awaiting_approval';
      update = {
        status: 'approved',
        approval_status: 'approved',
        approved_by: user.id,
        approved_at: nowIso,
        owner_note: body.ownerNote?.trim() || null,
      };
      break;
    }
    case 'reject_purchase': {
      allowed = isAdmin && r.status === 'awaiting_approval';
      update = {
        status: 'rejected',
        approval_status: 'rejected',
        approved_by: user.id,
        approved_at: nowIso,
        owner_note: body.ownerNote?.trim() || null,
      };
      break;
    }
    case 'cancel': {
      const canCancel = r.reported_by === user.id || isAdmin || role === 'manager';
      allowed =
        canCancel &&
        (['pending', 'in_progress', 'awaiting_approval', 'approved'] as RepairStatus[]).includes(
          r.status,
        );
      update = { status: 'cancelled' };
      break;
    }
    default:
      return NextResponse.json({ error: 'การกระทำไม่ถูกต้อง' }, { status: 400 });
  }

  if (!allowed) {
    return NextResponse.json(
      { error: 'ไม่มีสิทธิ์ดำเนินการนี้ หรือสถานะปัจจุบันไม่อนุญาต' },
      { status: 403 },
    );
  }

  const { data: updated, error: updateErr } = await supabase
    .from('repair_requests')
    .update(update)
    .eq('id', id)
    .select('*')
    .single();
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  // ----- Notifications -----
  const link = `/repairs/${id}`;
  // Branch name so multi-store technicians/owners know which branch.
  const { data: store } = await supabase
    .from('stores')
    .select('store_name')
    .eq('id', r.store_id)
    .maybeSingle();
  const storeName = (store as { store_name?: string } | null)?.store_name || '';
  const branchTag = storeName ? ` · ${storeName}` : '';
  try {
    if (body.action === 'request_purchase') {
      const cost = update.estimated_cost ? ` (~${update.estimated_cost.toLocaleString('th-TH')} บาท)` : '';
      await notifyStoreStaff({
        storeId: r.store_id,
        type: 'repair_purchase_request',
        title: `🛒 ขออนุมัติสั่งซื้อเพื่อซ่อม${branchTag}`,
        body: `${r.title}${cost} — ${actorName} แจ้งว่าต้องสั่งซื้ออะไหล่`,
        data: { repairId: id, url: link, storeName },
        roles: ['owner'],
      });
    } else if (body.action === 'approve_purchase' || body.action === 'reject_purchase') {
      const approved = body.action === 'approve_purchase';
      await notifyStoreStaff({
        storeId: r.store_id,
        type: approved ? 'repair_approved' : 'repair_rejected',
        title: `${approved ? '✅ อนุมัติสั่งซื้อแล้ว' : '❌ ไม่อนุมัติการสั่งซื้อ'}${branchTag}`,
        body: `${r.title} — ${approved ? 'เจ้าของอนุมัติให้สั่งซื้อ ดำเนินการซ่อมต่อได้' : 'เจ้าของไม่อนุมัติ'}`,
        data: { repairId: id, url: link, storeName },
        roles: ['technician'],
        excludeUserId: user.id,
      });
    } else if (body.action === 'complete') {
      if (r.reported_by && r.reported_by !== user.id) {
        await notifyUserWithLine({
          userId: r.reported_by,
          storeId: r.store_id,
          type: 'repair_completed',
          title: `🔧 งานแจ้งซ่อมเสร็จแล้ว${branchTag}`,
          body: `${r.title} — ซ่อมเสร็จเรียบร้อยโดย ${actorName}`,
          data: { repairId: id, url: link, storeName },
        });
      }
    }
  } catch (error) {
    console.error('[repairs] notify error:', error);
  }

  // Audit (non-fatal)
  try {
    const svc = createServiceClient();
    await svc.from('audit_logs').insert({
      store_id: r.store_id,
      action_type: `REPAIR_${body.action.toUpperCase()}`,
      table_name: 'repair_requests',
      new_value: { repair_id: id, status: update.status },
      changed_by: user.id,
    });
  } catch {
    // ignore
  }

  return NextResponse.json({ repair: updated });
}
