import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { notifyTaskUsers } from '@/lib/tasks/notify';
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

  let tasks = (data ?? []).map((t) => {
    const row = t as unknown as TaskWithRelations & { store?: { store_name?: string } | null };
    return {
      ...row,
      store_name: row.store?.store_name ?? null,
      is_mine: (row.assignees ?? []).some((a) => a.user_id === user.id),
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

  // Validate approvers/assignees are members of the room
  const { data: memberRows } = await supabase
    .from('task_room_members')
    .select('user_id')
    .eq('room_id', body.roomId);
  const memberSet = new Set((memberRows ?? []).map((m) => m.user_id));

  const assigneeIds = [...new Set(body.assigneeIds ?? [])].filter((id) => memberSet.has(id));
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

  // ประเภทการตอบกลับ — งานแบบ แจ้งเพื่อทราบ/กดรับทราบ ไม่มีขั้นอนุมัติ/แนบไฟล์
  const responseType: TaskResponseType = (['notify', 'acknowledge', 'submit'] as TaskResponseType[]).includes(
    body.responseType as TaskResponseType,
  )
    ? (body.responseType as TaskResponseType)
    : 'submit';
  const isSubmitType = responseType === 'submit';
  const requiresApproval = isSubmitType && !!body.requiresApproval;
  const requireAttachment = isSubmitType && !!body.requireAttachment;
  const effApproverIds = isSubmitType ? approverIds : [];

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
      created_by: user.id,
    })
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const created = task as Task;

  // Assignees
  if (assigneeIds.length > 0) {
    await supabase.from('task_assignees').insert(
      assigneeIds.map((uid) => ({ task_id: created.id, user_id: uid })),
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

  // Notify assignees (in-app + push, no LINE)
  if (assigneeIds.length > 0) {
    await notifyTaskUsers({
      userIds: assigneeIds,
      storeId: created.store_id,
      type: 'task_assigned',
      title: `📋 ได้รับมอบหมายงานใหม่`,
      body: `${created.ticket_no} · ${title}`,
      data: { taskId: created.id, roomId: body.roomId, url: `/tasks/${body.roomId}` },
      excludeUserId: user.id,
    });
  }

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
