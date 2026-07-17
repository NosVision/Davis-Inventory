import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { notifyTaskUsers, notifyTaskLineGroup } from '@/lib/tasks/notify';
import { resolveTargetUserIds, userMatchesTarget, getClaimableTaskIds } from '@/lib/tasks/resolve-target';
import {
  OPEN_TASK_STATUSES,
  CLOSED_TASK_STATUSES,
} from '@/lib/tasks/status';
import { daysAgoBangkokISO, todayBangkok } from '@/lib/utils/date';
import type {
  Task,
  TaskWithRelations,
  TaskPriority,
  TaskResponseType,
  TaskAttachmentInput,
  TaskAssignMode,
  TaskTarget,
} from '@/types/tasks';

const TASK_SELECT = `
  *,
  assignees:task_assignees(*, profile:profiles(id, display_name, username, avatar_url, role)),
  attachments:task_attachments(*),
  assigner:profiles!tasks_assigner_id_fkey(id, display_name, username, avatar_url, role),
  store:stores(store_name)
`;

interface CreateTaskBody {
  roomId: string;
  title: string;
  detail?: string;
  category?: string;
  storeId?: string | null;
  priority?: TaskPriority;
  dueDate?: string | null;
  requiresApproval?: boolean;
  approverIds?: string[];
  requireAttachment?: boolean;
  assigneeIds?: string[];
  attachments?: TaskAttachmentInput[];
  startDate?: string | null;
  responseType?: TaskResponseType;
}

// GET /api/tasks?roomId=&tab=open|closed|all&mine=1&search=&range=7|30|month|all
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sp = request.nextUrl.searchParams;
  const roomId = sp.get('roomId');
  const tab = sp.get('tab') ?? 'all';
  const mine = sp.get('mine') === '1';
  const search = sp.get('search')?.trim();
  const range = sp.get('range') ?? 'all';

  let query = supabase
    .from('tasks')
    .select(TASK_SELECT)
    .order('created_at', { ascending: false })
    .limit(300);

  if (roomId) query = query.eq('room_id', roomId);

  if (tab === 'open') query = query.in('status', OPEN_TASK_STATUSES);
  else if (tab === 'closed') query = query.in('status', CLOSED_TASK_STATUSES);
  else if (tab === 'upcoming') query = query.eq('status', 'scheduled');

  if (search) {
    const q = search.replace(/[%,]/g, '');
    query = query.or(`title.ilike.%${q}%,detail.ilike.%${q}%,ticket_no.ilike.%${q}%`);
  }

  if (range === '7') query = query.gte('created_at', daysAgoBangkokISO(7));
  else if (range === '30') query = query.gte('created_at', daysAgoBangkokISO(30));
  else if (range === 'month') query = query.gte('created_at', daysAgoBangkokISO(31));

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as unknown as (TaskWithRelations & { store?: { store_name?: string } | null })[];
  const claimableIds = await getClaimableTaskIds(
    rows.map((r) => ({
      id: r.id,
      room_id: r.room_id,
      status: r.status,
      assigneeCount: (r.assignees ?? []).length,
      openClaim: (r.meta as { open_claim?: boolean } | null)?.open_claim === true,
    })),
    user.id,
  );

  let tasks = rows.map((row) => {
    return {
      ...row,
      store_name: row.store?.store_name ?? null,
      is_mine: (row.assignees ?? []).some((a) => a.user_id === user.id),
      can_claim: claimableIds.has(row.id),
    } as TaskWithRelations;
  });

  if (mine) tasks = tasks.filter((t) => t.is_mine);

  return NextResponse.json({ tasks });
}

// POST /api/tasks — create a task
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: CreateTaskBody;
  try {
    body = (await request.json()) as CreateTaskBody;
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const title = body.title?.trim();
  if (!body.roomId || !title) {
    return NextResponse.json({ error: 'กรุณาระบุห้องและหัวข้องาน' }, { status: 400 });
  }

  // ── คอนฟิกโฟลของห้อง (00059) ──
  const { data: roomCfg } = await supabase
    .from('task_rooms')
    .select('assign_mode, responsible_target, default_response_type, require_attachment_default, creator_target')
    .eq('id', body.roomId)
    .maybeSingle();
  const assignMode = (roomCfg?.assign_mode as TaskAssignMode | undefined) ?? 'manual';
  const roomRespTarget = (roomCfg?.responsible_target as TaskTarget | null) ?? null;
  const creatorTarget = (roomCfg?.creator_target as TaskTarget | null) ?? null;

  // สิทธิ์เปิดเรื่อง (creator_target) — เจ้าของข้ามได้เสมอ
  const { data: meProfile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();
  if (meProfile?.role !== 'owner' && !(await userMatchesTarget(user.id, creatorTarget))) {
    return NextResponse.json({ error: 'คุณไม่มีสิทธิ์เปิดเรื่องในห้องนี้' }, { status: 403 });
  }

  // Validate approvers/assignees are members of the room
  const { data: memberRows } = await supabase
    .from('task_room_members')
    .select('user_id')
    .eq('room_id', body.roomId);
  const memberSet = new Set((memberRows ?? []).map((m) => m.user_id));

  const manualAssigneeIds = [...new Set(body.assigneeIds ?? [])].filter((id) => memberSet.has(id));
  const approverIds = [...new Set(body.approverIds ?? [])].filter((id) => memberSet.has(id));

  if ((body.approverIds?.length ?? 0) > 0 && approverIds.length !== body.approverIds!.length) {
    return NextResponse.json(
      { error: 'ผู้อนุมัติต้องเป็นสมาชิกของห้องนี้' },
      { status: 400 },
    );
  }

  // Generate per-room ticket number (server-side, serialized)
  const { data: ticketNo, error: ticketErr } = await supabase.rpc('next_task_ticket', {
    p_room: body.roomId,
  });
  if (ticketErr) return NextResponse.json({ error: ticketErr.message }, { status: 500 });

  const priority: TaskPriority = (['low', 'med', 'high'] as TaskPriority[]).includes(
    body.priority as TaskPriority,
  )
    ? (body.priority as TaskPriority)
    : 'med';

  // ประเภทการตอบกลับ: ค่าจากฟอร์ม > default ของห้อง > 'submit'
  const validResp = (v: unknown): TaskResponseType | null =>
    (['notify', 'acknowledge', 'submit'] as TaskResponseType[]).includes(v as TaskResponseType)
      ? (v as TaskResponseType)
      : null;
  const responseType: TaskResponseType =
    validResp(body.responseType) ?? validResp(roomCfg?.default_response_type) ?? 'submit';
  const isSubmitType = responseType === 'submit';
  const requiresApproval = isSubmitType && !!body.requiresApproval;
  const requireAttachment =
    isSubmitType && (!!body.requireAttachment || !!roomCfg?.require_attachment_default);
  const effApproverIds = isSubmitType ? approverIds : [];

  // ── มอบหมายตามโฟลของห้อง ──
  const svc = createServiceClient();
  let finalAssigneeIds: string[] = [];
  let openClaim = false;
  let resolvedResponsible: string[] = [];
  if (assignMode === 'manual') {
    finalAssigneeIds = manualAssigneeIds;
  } else {
    resolvedResponsible = await resolveTargetUserIds(roomRespTarget);
    // ผู้รับผิดชอบต้องเป็นสมาชิกห้อง (เพื่อให้เห็น/รับงานได้)
    if (resolvedResponsible.length > 0) {
      await svc.from('task_room_members').upsert(
        resolvedResponsible.map((uid) => ({ room_id: body.roomId, user_id: uid, added_by: user.id })),
        { onConflict: 'room_id,user_id', ignoreDuplicates: true },
      );
    }
    if (assignMode === 'all') finalAssigneeIds = resolvedResponsible;
    else openClaim = true; // claim — เปิดให้รับ
  }

  const { data: task, error } = await supabase
    .from('tasks')
    .insert({
      room_id: body.roomId,
      ticket_no: ticketNo as string,
      store_id: body.storeId || null,
      category: body.category?.trim() || null,
      title,
      detail: body.detail?.trim() || null,
      status: body.startDate && body.startDate > todayBangkok() ? 'scheduled' : 'in_progress',
      priority,
      requires_approval: requiresApproval,
      approver_ids: effApproverIds,
      require_attachment: requireAttachment,
      response_type: responseType,
      assigner_id: user.id,
      start_date: body.startDate || null,
      due_date: body.dueDate || null,
      meta: openClaim ? { open_claim: true } : null,
      created_by: user.id,
    })
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const created = task as Task;

  // Assignees (manual/all)
  if (finalAssigneeIds.length > 0) {
    await svc.from('task_assignees').insert(
      finalAssigneeIds.map((uid) => ({ task_id: created.id, user_id: uid })),
    );
  }

  // Attachments (optional)
  const attachments = (body.attachments ?? []).filter((a) => a?.url);
  if (attachments.length > 0) {
    await supabase.from('task_attachments').insert(
      attachments.map((a) => ({
        task_id: created.id,
        kind: a.kind,
        url: a.url,
        name: a.name || null,
        uploaded_by: user.id,
      })),
    );
  }

  // Notify (in-app + push, no LINE for the per-user channel)
  if (openClaim && resolvedResponsible.length > 0) {
    await notifyTaskUsers({
      userIds: resolvedResponsible,
      storeId: created.store_id,
      type: 'task_assigned',
      title: `🆕 มีงานใหม่รอรับ`,
      body: `${created.ticket_no} · ${title}`,
      data: { taskId: created.id, roomId: body.roomId, url: `/tasks/${body.roomId}` },
      excludeUserId: user.id,
    });
  } else if (finalAssigneeIds.length > 0) {
    await notifyTaskUsers({
      userIds: finalAssigneeIds,
      storeId: created.store_id,
      type: 'task_assigned',
      title: `📋 ได้รับมอบหมายงานใหม่`,
      body: `${created.ticket_no} · ${title}`,
      data: { taskId: created.id, roomId: body.roomId, url: `/tasks/${body.roomId}` },
      excludeUserId: user.id,
    });
  }

  // Room LINE group (central task bot) — fires once per new task when the room enables it.
  await notifyTaskLineGroup(
    created.room_id as string,
    openClaim ? '🆕 มีงานใหม่รอรับ' : '📋 มีงานใหม่',
    `${created.ticket_no} · ${title}`,
  );

  // Audit (non-fatal)
  try {
    const svc = createServiceClient();
    await svc.from('audit_logs').insert({
      store_id: created.store_id,
      action_type: 'TASK_CREATED',
      table_name: 'tasks',
      record_id: created.id,
      new_value: { ticket_no: created.ticket_no, title, room_id: body.roomId },
      changed_by: user.id,
    });
  } catch {
    // ignore
  }

  return NextResponse.json({ task: created });
}
