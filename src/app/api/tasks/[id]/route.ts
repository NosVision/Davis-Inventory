import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { notifyTaskUsers, getRoomMemberIds } from '@/lib/tasks/notify';
import { userMatchesTarget } from '@/lib/tasks/resolve-target';
import type {
  Task,
  TaskWithRelations,
  TaskAssignee,
  TaskAttachmentInput,
  TaskTarget,
} from '@/types/tasks';

const TASK_SELECT = `
  *,
  assignees:task_assignees(*, profile:profiles(id, display_name, username, avatar_url, role)),
  attachments:task_attachments(*),
  assigner:profiles!tasks_assigner_id_fkey(id, display_name, username, avatar_url, role),
  store:stores(store_name)
`;

type Action =
  | 'acknowledge'
  | 'submit'
  | 'request_approval'
  | 'approve'
  | 'reject'
  | 'cancel'
  | 'start_now'
  | 'claim'
  | 'pin'
  | 'unpin'
  | 'add_attachment';
interface PatchBody {
  action: Action;
  note?: string;
  ownerNote?: string;
  items?: string;
  cost?: number;
  attachments?: TaskAttachmentInput[];
}

// GET /api/tasks/[id] — task detail
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('tasks')
    .select(TASK_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'ไม่พบงาน' }, { status: 404 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  const row = data as unknown as TaskWithRelations & { store?: { store_name?: string } | null };
  const isOwner = profile?.role === 'owner';
  const isApprover = (row.approver_ids ?? []).includes(user.id);
  const task: TaskWithRelations = {
    ...row,
    store_name: row.store?.store_name ?? null,
    is_mine: (row.assignees ?? []).some((a) => a.user_id === user.id),
  };

  // งานแบบเปิดให้รับ (claim) — ต้องเช็คว่าผู้ใช้ตรงกับ "ผู้รับผิดชอบ" ที่ห้องตั้งไว้จริงไหม
  // ไม่งั้นทุกคน (รวมถึงคนแจ้งเรื่อง/เจ้าของร้าน) จะเห็นปุ่ม "รับงาน" ได้แม้ตั้งเฉพาะตำแหน่งไว้
  const isOpenClaim =
    row.status === 'in_progress' &&
    (row.assignees ?? []).length === 0 &&
    (row.meta as { open_claim?: boolean } | null | undefined)?.open_claim === true;
  let canClaim = false;
  if (isOpenClaim) {
    const { data: roomCfg } = await supabase
      .from('task_rooms')
      .select('responsible_target')
      .eq('id', row.room_id)
      .maybeSingle();
    const responsibleTarget = (roomCfg?.responsible_target as TaskTarget | null) ?? null;
    canClaim = await userMatchesTarget(user.id, responsibleTarget);
  }

  return NextResponse.json({ task, canApprove: isOwner || isApprover, isOwner, canClaim });
}

// PATCH /api/tasks/[id] — workflow actions
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const actorId = user.id;

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

  const { data: taskData, error: fetchErr } = await supabase
    .from('tasks')
    .select('*, assignees:task_assignees(*), attachments:task_attachments(id)')
    .eq('id', id)
    .maybeSingle();
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!taskData) return NextResponse.json({ error: 'ไม่พบงาน' }, { status: 404 });

  const task = taskData as unknown as Task & {
    assignees: TaskAssignee[];
    attachments: { id: string }[];
  };
  const assignees = task.assignees ?? [];
  const nowIso = new Date().toISOString();

  const isOwner = role === 'owner';
  const isApprover = (task.approver_ids ?? []).includes(user.id);
  const isAssignee = assignees.some((a) => a.user_id === user.id);
  const isAssigner = task.assigner_id === user.id;

  // กำลังรออนุมัติแบบไหน: 'purchase' (ขอกลางทาง — เจ้าของเท่านั้น) หรือ 'completion' (ตอนส่งงาน)
  const baseMeta: Record<string, unknown> =
    task.meta && typeof task.meta === 'object' ? (task.meta as Record<string, unknown>) : {};
  const ar = baseMeta.approval_request as { kind?: string } | undefined;
  const pendingKind: 'purchase' | 'completion' = ar?.kind === 'purchase' ? 'purchase' : 'completion';

  // Append any attachments first (shared by submit / add_attachment)
  const newAttachments = (body.attachments ?? []).filter((a) => a?.url);
  async function insertAttachments(phase: 'before' | 'after' | 'work') {
    if (newAttachments.length === 0) return;
    await supabase.from('task_attachments').insert(
      newAttachments.map((a) => ({
        task_id: id,
        kind: a.kind,
        url: a.url,
        name: a.name || null,
        phase,
        uploaded_by: actorId,
      })),
    );
  }

  const notifyIds = (extra: (string | null)[] = []) =>
    [...assignees.map((a) => a.user_id), task.assigner_id, ...extra].filter(
      (x): x is string => !!x,
    );

  switch (body.action) {
    case 'add_attachment': {
      if (!isAssignee && !isOwner && !isAssigner) {
        return NextResponse.json({ error: 'ไม่มีสิทธิ์' }, { status: 403 });
      }
      await insertAttachments('work');
      break;
    }

    case 'acknowledge': {
      if (!isAssignee) return NextResponse.json({ error: 'ไม่ใช่ผู้รับผิดชอบงานนี้' }, { status: 403 });
      await supabase
        .from('task_assignees')
        .update({ state: 'acknowledged' })
        .eq('task_id', id)
        .eq('user_id', user.id);
      break;
    }

    case 'submit': {
      const canSubmit = isAssignee || ((isOwner || isAssigner) && assignees.length === 0);
      if (!canSubmit) {
        return NextResponse.json({ error: 'ไม่ใช่ผู้รับผิดชอบงานนี้' }, { status: 403 });
      }
      if (task.status !== 'in_progress') {
        return NextResponse.json({ error: 'สถานะปัจจุบันส่งงานไม่ได้' }, { status: 400 });
      }
      // require_attachment: ต้องมีไฟล์แนบอย่างน้อย 1 ก่อนส่ง
      if (task.require_attachment && (task.attachments?.length ?? 0) + newAttachments.length === 0) {
        return NextResponse.json({ error: 'งานนี้ต้องแนบไฟล์/รูปก่อนส่ง' }, { status: 400 });
      }
      await insertAttachments('after');

      // mark this assignee submitted
      if (isAssignee) {
        await supabase
          .from('task_assignees')
          .update({ state: 'submitted', submitted_at: nowIso, note: body.note?.trim() || null })
          .eq('task_id', id)
          .eq('user_id', user.id);
      }

      // recompute: all assignees submitted? (no assignees → owner/assigner submit = all done)
      const others = assignees.filter((a) => a.user_id !== user.id);
      const allSubmitted =
        assignees.length === 0 ||
        others.every((a) => a.state === 'submitted' || a.state === 'done');

      if (allSubmitted) {
        if (task.requires_approval) {
          await supabase
            .from('tasks')
            .update({
              status: 'pending_approval',
              meta: { ...baseMeta, approval_request: { kind: 'completion', requested_by: actorId, requested_at: nowIso } },
            })
            .eq('id', id);
          const approvers = (task.approver_ids ?? []).length > 0 ? task.approver_ids : [task.assigner_id].filter(Boolean) as string[];
          await notifyTaskUsers({
            userIds: approvers,
            storeId: task.store_id,
            type: 'task_approval_request',
            title: `📝 มีงานรออนุมัติ`,
            body: `${task.ticket_no} · ${task.title} — ${actorName} ส่งงานแล้ว`,
            data: { taskId: id, roomId: task.room_id, url: `/tasks/${task.room_id}` },
            excludeUserId: user.id,
          });
        } else {
          await supabase
            .from('tasks')
            .update({ status: 'done', completed_by: user.id, completed_at: nowIso })
            .eq('id', id);
          await supabase.from('task_assignees').update({ state: 'done' }).eq('task_id', id);
          if (task.assigner_id && task.assigner_id !== user.id) {
            await notifyTaskUsers({
              userIds: [task.assigner_id],
              storeId: task.store_id,
              type: 'task_completed',
              title: `✅ งานเสร็จแล้ว`,
              body: `${task.ticket_no} · ${task.title} — โดย ${actorName}`,
              data: { taskId: id, roomId: task.room_id, url: `/tasks/${task.room_id}` },
            });
          }
        }
      }
      break;
    }

    case 'request_approval': {
      // ผู้รับผิดชอบ (หรือเจ้าของ/ผู้จ่ายงานถ้ายังไม่มีผู้รับผิดชอบ) ขออนุมัติจากเจ้าของ "กลางทาง"
      const canRequest = isAssignee || ((isOwner || isAssigner) && assignees.length === 0);
      if (!canRequest) {
        return NextResponse.json({ error: 'ไม่ใช่ผู้รับผิดชอบงานนี้' }, { status: 403 });
      }
      if (task.status !== 'in_progress') {
        return NextResponse.json({ error: 'ขออนุมัติได้เฉพาะงานที่กำลังดำเนินการ' }, { status: 400 });
      }
      await insertAttachments('work');
      const cost =
        typeof body.cost === 'number' && Number.isFinite(body.cost) ? body.cost : null;
      await supabase
        .from('tasks')
        .update({
          status: 'pending_approval',
          estimated_cost: cost,
          meta: {
            ...baseMeta,
            approval_request: {
              kind: 'purchase',
              cost,
              items: body.items?.trim() || null,
              note: body.note?.trim() || null,
              requested_by: actorId,
              requested_at: nowIso,
            },
          },
        })
        .eq('id', id);
      // แจ้งเจ้าของของห้อง (อนุมัติการซื้อ = เจ้าของเท่านั้น)
      const ownerIds = await getRoomMemberIds(task.room_id, { roles: ['owner'] });
      await notifyTaskUsers({
        userIds: ownerIds,
        storeId: task.store_id,
        type: 'task_approval_request',
        title: `🛒 ขออนุมัติจากเจ้าของ`,
        body: `${task.ticket_no} · ${task.title}${cost ? ` (~${cost.toLocaleString('th-TH')} บาท)` : ''} — ${actorName}`,
        data: { taskId: id, roomId: task.room_id, url: `/tasks/${task.room_id}` },
        excludeUserId: actorId,
      });
      break;
    }

    case 'approve': {
      // อนุมัติซื้อของ = เจ้าของเท่านั้น; อนุมัติงานเสร็จ = เจ้าของหรือผู้อนุมัติที่แต่งตั้ง
      const allowed = pendingKind === 'purchase' ? isOwner : isOwner || isApprover;
      if (!allowed) {
        return NextResponse.json({ error: 'อนุมัติได้เฉพาะเจ้าของ' + (pendingKind === 'purchase' ? '' : 'หรือผู้อนุมัติที่ถูกแต่งตั้ง') }, { status: 403 });
      }
      if (task.status !== 'pending_approval') {
        return NextResponse.json({ error: 'งานนี้ไม่ได้อยู่ในสถานะรออนุมัติ' }, { status: 400 });
      }
      const decidedAr = { ...(ar ?? {}), result: 'approved', decided_by: actorId, decided_at: nowIso };

      if (pendingKind === 'purchase') {
        // อนุมัติการซื้อ → กลับไปทำงานต่อ
        await supabase
          .from('tasks')
          .update({
            status: 'in_progress',
            owner_note: body.ownerNote?.trim() || null,
            meta: { ...baseMeta, approval_request: decidedAr },
          })
          .eq('id', id);
        await notifyTaskUsers({
          userIds: notifyIds(),
          storeId: task.store_id,
          type: 'task_approved',
          title: `✅ เจ้าของอนุมัติแล้ว — ดำเนินการต่อได้`,
          body: `${task.ticket_no} · ${task.title}`,
          data: { taskId: id, roomId: task.room_id, url: `/tasks/${task.room_id}` },
          excludeUserId: actorId,
        });
      } else {
        await supabase
          .from('tasks')
          .update({
            status: 'done',
            approval_status: 'approved',
            approved_by: actorId,
            approved_at: nowIso,
            completed_at: nowIso,
            owner_note: body.ownerNote?.trim() || null,
            meta: { ...baseMeta, approval_request: decidedAr },
          })
          .eq('id', id);
        await supabase.from('task_assignees').update({ state: 'done' }).eq('task_id', id);
        await notifyTaskUsers({
          userIds: notifyIds(),
          storeId: task.store_id,
          type: 'task_approved',
          title: `✅ งานได้รับการอนุมัติ`,
          body: `${task.ticket_no} · ${task.title}`,
          data: { taskId: id, roomId: task.room_id, url: `/tasks/${task.room_id}` },
          excludeUserId: actorId,
        });
      }
      break;
    }

    case 'reject': {
      const allowed = pendingKind === 'purchase' ? isOwner : isOwner || isApprover;
      if (!allowed) {
        return NextResponse.json({ error: 'ดำเนินการได้เฉพาะเจ้าของ' + (pendingKind === 'purchase' ? '' : 'หรือผู้อนุมัติที่ถูกแต่งตั้ง') }, { status: 403 });
      }
      if (task.status !== 'pending_approval') {
        return NextResponse.json({ error: 'งานนี้ไม่ได้อยู่ในสถานะรออนุมัติ' }, { status: 400 });
      }
      const decidedAr = { ...(ar ?? {}), result: 'rejected', decided_by: actorId, decided_at: nowIso };

      if (pendingKind === 'purchase') {
        // ไม่อนุมัติการซื้อ → กลับไปทำงานต่อ (วิธีอื่น) พร้อมโน้ต
        await supabase
          .from('tasks')
          .update({
            status: 'in_progress',
            owner_note: body.ownerNote?.trim() || null,
            meta: { ...baseMeta, approval_request: decidedAr },
          })
          .eq('id', id);
        await notifyTaskUsers({
          userIds: notifyIds(),
          storeId: task.store_id,
          type: 'task_rejected',
          title: `❌ เจ้าของไม่อนุมัติ — ทำวิธีอื่นต่อ`,
          body: `${task.ticket_no} · ${task.title}${body.ownerNote ? ` — ${body.ownerNote.trim()}` : ''}`,
          data: { taskId: id, roomId: task.room_id, url: `/tasks/${task.room_id}` },
          excludeUserId: actorId,
        });
      } else {
        await supabase
          .from('tasks')
          .update({
            status: 'rejected',
            approval_status: 'rejected',
            approved_by: actorId,
            approved_at: nowIso,
            owner_note: body.ownerNote?.trim() || null,
            meta: { ...baseMeta, approval_request: decidedAr },
          })
          .eq('id', id);
        await notifyTaskUsers({
          userIds: notifyIds(),
          storeId: task.store_id,
          type: 'task_rejected',
          title: `❌ งานไม่ผ่านการอนุมัติ`,
          body: `${task.ticket_no} · ${task.title}${body.ownerNote ? ` — ${body.ownerNote.trim()}` : ''}`,
          data: { taskId: id, roomId: task.room_id, url: `/tasks/${task.room_id}` },
          excludeUserId: actorId,
        });
      }
      break;
    }

    case 'start_now': {
      // เริ่มงานที่ "รอเริ่ม" ก่อนถึงวันได้ (ผู้รับผิดชอบ/ผู้จ่ายงาน/เจ้าของ)
      if (!isAssignee && !isOwner && !isAssigner) {
        return NextResponse.json({ error: 'ไม่มีสิทธิ์' }, { status: 403 });
      }
      if (task.status !== 'scheduled') {
        return NextResponse.json({ error: 'งานนี้ไม่ได้อยู่ในสถานะรอเริ่ม' }, { status: 400 });
      }
      await supabase.from('tasks').update({ status: 'in_progress' }).eq('id', id);
      break;
    }

    case 'claim': {
      // งานแบบเปิดให้รับ (claim) ที่ยังไม่มีผู้รับผิดชอบ → ผู้รับกดรับเอง
      if (assignees.length > 0) {
        return NextResponse.json({ error: 'งานนี้มีผู้รับผิดชอบแล้ว' }, { status: 400 });
      }
      if (task.status !== 'in_progress') {
        return NextResponse.json({ error: 'สถานะปัจจุบันรับงานไม่ได้' }, { status: 400 });
      }
      // ต้องตรงกับ "ผู้รับผิดชอบ" ที่ห้องตั้งไว้ (เช่น เฉพาะตำแหน่งช่าง) — ไม่ใช่แค่เป็นสมาชิกห้อง
      // (สมาชิกห้องอาจรวมทุกคนที่แจ้งเรื่องได้ ไม่ได้แปลว่ารับงานได้) และเจ้าของร้านก็ไม่ยกเว้น
      // เพื่อกันเคสคนแจ้งเรื่อง/เจ้าของร้านกดรับงานที่ตั้งไว้ให้ตำแหน่งอื่นโดยไม่ตั้งใจ
      const { data: roomCfg } = await supabase
        .from('task_rooms')
        .select('responsible_target')
        .eq('id', task.room_id)
        .maybeSingle();
      const responsibleTarget = (roomCfg?.responsible_target as TaskTarget | null) ?? null;
      if (!(await userMatchesTarget(actorId, responsibleTarget))) {
        return NextResponse.json(
          { error: 'คุณไม่ได้อยู่ในกลุ่มผู้รับผิดชอบของงานนี้' },
          { status: 403 },
        );
      }
      const svc = createServiceClient();
      await svc.from('task_assignees').insert({ task_id: id, user_id: actorId });
      await svc
        .from('tasks')
        .update({ meta: { ...baseMeta, open_claim: false, claimed_by: actorId, claimed_at: nowIso } })
        .eq('id', id);
      if (task.assigner_id && task.assigner_id !== actorId) {
        await notifyTaskUsers({
          userIds: [task.assigner_id],
          storeId: task.store_id,
          type: 'task_assigned',
          title: `🙌 มีคนรับงานแล้ว`,
          body: `${task.ticket_no} · ${task.title} — ${actorName} รับงาน`,
          data: { taskId: id, roomId: task.room_id, url: `/tasks/${task.room_id}` },
        });
      }
      break;
    }

    case 'cancel': {
      if (!isOwner && !isAssigner) {
        return NextResponse.json({ error: 'ยกเลิกได้เฉพาะผู้จ่ายงานหรือเจ้าของ' }, { status: 403 });
      }
      if (!['in_progress', 'pending_approval', 'scheduled'].includes(task.status)) {
        return NextResponse.json({ error: 'สถานะปัจจุบันยกเลิกไม่ได้' }, { status: 400 });
      }
      await supabase.from('tasks').update({ status: 'cancelled' }).eq('id', id);
      break;
    }

    case 'pin':
    case 'unpin': {
      // ปักหมุดได้: เจ้าของ / หัวหน้าห้อง / ผู้จ่ายงาน
      const { data: mem } = await supabase
        .from('task_room_members')
        .select('role')
        .eq('room_id', task.room_id)
        .eq('user_id', actorId)
        .maybeSingle();
      if (!isOwner && !isAssigner && mem?.role !== 'manager') {
        return NextResponse.json({ error: 'ปักหมุดได้เฉพาะเจ้าของ/หัวหน้าห้อง/ผู้จ่ายงาน' }, { status: 403 });
      }
      const pin = body.action === 'pin';
      await supabase
        .from('tasks')
        .update({ is_pinned: pin, pinned_at: pin ? nowIso : null })
        .eq('id', id);
      break;
    }

    default:
      return NextResponse.json({ error: 'การกระทำไม่ถูกต้อง' }, { status: 400 });
  }

  // Audit (non-fatal)
  try {
    const svc = createServiceClient();
    await svc.from('audit_logs').insert({
      store_id: task.store_id,
      action_type: `TASK_${body.action.toUpperCase()}`,
      table_name: 'tasks',
      record_id: id,
      new_value: { ticket_no: task.ticket_no, by: actorName },
      changed_by: user.id,
    });
  } catch {
    // ignore
  }

  const { data: updated } = await supabase
    .from('tasks')
    .select(TASK_SELECT)
    .eq('id', id)
    .maybeSingle();

  return NextResponse.json({ task: updated });
}
