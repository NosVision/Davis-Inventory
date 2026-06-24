import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type {
  TaskRecurrence,
  TaskRecurrenceKind,
  TaskPriority,
  TaskResponseType,
  TaskAttachmentInput,
} from '@/types/tasks';

interface CreateBody {
  roomId: string;
  title: string;
  detail?: string;
  category?: string;
  storeId?: string | null;
  priority?: TaskPriority;
  kind: TaskRecurrenceKind;
  startDate: string;
  dayOfMonth?: number | null;
  intervalCount?: number;
  requiresApproval?: boolean;
  requireAttachment?: boolean;
  approverIds?: string[];
  defaultAssigneeIds?: string[];
  remindEveryDays?: number | null;
  responseType?: TaskResponseType;
  attachments?: TaskAttachmentInput[];
}

// GET /api/tasks/recurrences?roomId=
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const roomId = request.nextUrl.searchParams.get('roomId');
  let q = supabase.from('task_recurrences').select('*').order('created_at', { ascending: false });
  if (roomId) q = q.eq('room_id', roomId);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ recurrences: (data ?? []) as TaskRecurrence[] });
}

// POST /api/tasks/recurrences — create template (owner; RLS enforces) + materialize now
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const title = body.title?.trim();
  if (!body.roomId || !title || !body.kind || !body.startDate) {
    return NextResponse.json({ error: 'กรอกข้อมูลงานประจำให้ครบ' }, { status: 400 });
  }

  // validate assignees/approvers are room members
  const { data: memberRows } = await supabase
    .from('task_room_members')
    .select('user_id')
    .eq('room_id', body.roomId);
  const memberSet = new Set((memberRows ?? []).map((m) => m.user_id));
  const defaultAssigneeIds = [...new Set(body.defaultAssigneeIds ?? [])].filter((id) => memberSet.has(id));
  const approverIds = [...new Set(body.approverIds ?? [])].filter((id) => memberSet.has(id));

  const priority: TaskPriority = (['low', 'med', 'high'] as TaskPriority[]).includes(body.priority as TaskPriority)
    ? (body.priority as TaskPriority)
    : 'med';
  const responseType: TaskResponseType = (['notify', 'acknowledge', 'submit'] as TaskResponseType[]).includes(
    body.responseType as TaskResponseType,
  )
    ? (body.responseType as TaskResponseType)
    : 'submit';
  const isSubmitType = responseType === 'submit';

  const { data: rec, error } = await supabase
    .from('task_recurrences')
    .insert({
      room_id: body.roomId,
      store_id: body.storeId || null,
      title,
      detail: body.detail?.trim() || null,
      category: body.category?.trim() || null,
      priority,
      requires_approval: isSubmitType && !!body.requiresApproval,
      require_attachment: isSubmitType && !!body.requireAttachment,
      response_type: responseType,
      approver_ids: isSubmitType ? approverIds : [],
      default_assignee_ids: defaultAssigneeIds,
      attachments: (body.attachments ?? []).filter((a) => a?.url),
      kind: body.kind,
      start_date: body.startDate,
      day_of_month: body.kind === 'day_of_month' ? body.dayOfMonth ?? null : null,
      interval_count: Math.max(1, Number(body.intervalCount) || 1),
      remind_every_days: body.remindEveryDays ?? null,
      created_by: user.id,
    })
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Materialize occurrences immediately so they show up on the calendar/list
  await supabase.rpc('generate_task_occurrences');

  return NextResponse.json({ recurrence: rec });
}
