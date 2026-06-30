import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sanitizeTarget } from '@/lib/tasks/target';
import { userMatchesTarget } from '@/lib/tasks/resolve-target';
import type { TaskAssignMode, TaskResponseType, TaskRoom, TaskRoomMember, TaskTarget } from '@/types/tasks';

const ASSIGN_MODES: TaskAssignMode[] = ['manual', 'claim', 'all'];
const RESPONSE_TYPES: TaskResponseType[] = ['notify', 'acknowledge', 'submit'];

const MEMBER_SELECT =
  '*, profile:profiles!task_room_members_user_id_fkey(id, display_name, username, avatar_url, role)';

// GET /api/tasks/rooms/[roomId] — room detail + members
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const { roomId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [{ data: room, error }, { data: members }, { data: profile }] = await Promise.all([
    supabase.from('task_rooms').select('*').eq('id', roomId).maybeSingle(),
    supabase
      .from('task_room_members')
      .select(MEMBER_SELECT)
      .eq('room_id', roomId)
      .order('joined_at', { ascending: true }),
    supabase.from('profiles').select('role').eq('id', user.id).single(),
  ]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!room) return NextResponse.json({ error: 'ไม่พบห้องงาน' }, { status: 404 });

  const memberList = (members ?? []) as TaskRoomMember[];
  // สิทธิ์เปิดเรื่องของผู้ใช้คนนี้ — เจ้าของข้ามได้เสมอ ที่เหลือเทียบกับ creator_target
  // (logic เดียวกับฝั่งสร้างงานใน POST /api/tasks เพื่อให้ UI ตรงกับ backend)
  const creatorTarget = (room as { creator_target?: TaskTarget | null }).creator_target ?? null;
  const canCreate =
    profile?.role === 'owner' || (await userMatchesTarget(user.id, creatorTarget));

  return NextResponse.json({
    room: room as TaskRoom,
    members: memberList,
    isOwner: profile?.role === 'owner',
    isMember: memberList.some((m) => m.user_id === user.id),
    canCreate,
  });
}

// PATCH /api/tasks/rooms/[roomId] — update room (owner only)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const { roomId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();
  if (profile?.role !== 'owner') {
    return NextResponse.json({ error: 'เฉพาะเจ้าของร้านเท่านั้น' }, { status: 403 });
  }

  let body: Partial<{
    name: string;
    description: string;
    icon: string;
    color: string;
    ticketPrefix: string;
    isArchived: boolean;
    assignMode: TaskAssignMode;
    defaultResponseType: TaskResponseType;
    responsibleTarget: TaskTarget;
    creatorTarget: TaskTarget;
    requireAttachmentDefault: boolean;
  }>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if (typeof body.name === 'string') update.name = body.name.trim();
  if (typeof body.description === 'string') update.description = body.description.trim() || null;
  if (typeof body.icon === 'string') update.icon = body.icon.trim();
  if (typeof body.color === 'string') update.color = body.color.trim();
  if (typeof body.ticketPrefix === 'string') update.ticket_prefix = body.ticketPrefix.trim();
  if (typeof body.isArchived === 'boolean') update.is_archived = body.isArchived;
  // ── คอนฟิกโฟลงาน (00059) ──
  if (ASSIGN_MODES.includes(body.assignMode as TaskAssignMode)) update.assign_mode = body.assignMode;
  if (RESPONSE_TYPES.includes(body.defaultResponseType as TaskResponseType))
    update.default_response_type = body.defaultResponseType;
  if (body.responsibleTarget && typeof body.responsibleTarget === 'object')
    update.responsible_target = sanitizeTarget(body.responsibleTarget);
  if (body.creatorTarget && typeof body.creatorTarget === 'object')
    update.creator_target = sanitizeTarget(body.creatorTarget);
  if (typeof body.requireAttachmentDefault === 'boolean')
    update.require_attachment_default = body.requireAttachmentDefault;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'ไม่มีข้อมูลที่จะแก้ไข' }, { status: 400 });
  }

  const { data: room, error } = await supabase
    .from('task_rooms')
    .update(update)
    .eq('id', roomId)
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ room });
}

// DELETE /api/tasks/rooms/[roomId] — delete room (owner; not system rooms)
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const { roomId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();
  if (profile?.role !== 'owner') {
    return NextResponse.json({ error: 'เฉพาะเจ้าของร้านเท่านั้น' }, { status: 403 });
  }

  const { data: room } = await supabase
    .from('task_rooms')
    .select('is_system')
    .eq('id', roomId)
    .maybeSingle();
  if (room?.is_system) {
    return NextResponse.json({ error: 'ห้องระบบลบไม่ได้ (เก็บถาวรได้แทน)' }, { status: 400 });
  }

  const { error } = await supabase.from('task_rooms').delete().eq('id', roomId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
