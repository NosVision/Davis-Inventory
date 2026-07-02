import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sanitizeTarget } from '@/lib/tasks/target';
import type {
  TaskAssignMode,
  TaskResponseType,
  TaskRoom,
  TaskRoomWithStats,
  TaskStatus,
  TaskTarget,
} from '@/types/tasks';

const ASSIGN_MODES: TaskAssignMode[] = ['manual', 'claim', 'all'];
const RESPONSE_TYPES: TaskResponseType[] = ['notify', 'acknowledge', 'submit'];

interface CreateRoomBody {
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  ticketPrefix?: string;
  memberUserIds?: string[];
  assignMode?: TaskAssignMode;
  defaultResponseType?: TaskResponseType;
  responsibleTarget?: TaskTarget;
  creatorTarget?: TaskTarget;
  requireAttachmentDefault?: boolean;
}

// GET /api/tasks/rooms — list rooms visible to the user + per-room stats
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [roomsRes, membersRes, tasksRes, storesRes, favRes] = await Promise.all([
    supabase
      .from('task_rooms')
      .select('*')
      .eq('is_archived', false)
      .order('is_system', { ascending: false })
      .order('created_at', { ascending: true }),
    supabase.from('task_room_members').select('room_id, user_id'),
    supabase.from('tasks').select('room_id, status, store_id'),
    supabase.from('stores').select('id, store_name'),
    supabase.from('task_room_favorites').select('room_id'),
  ]);

  if (roomsRes.error) {
    return NextResponse.json({ error: roomsRes.error.message }, { status: 500 });
  }

  const rooms = (roomsRes.data ?? []) as TaskRoom[];
  const members = (membersRes.data ?? []) as { room_id: string; user_id: string }[];
  const tasks = (tasksRes.data ?? []) as { room_id: string; status: TaskStatus; store_id: string | null }[];
  const storeMap = new Map<string, string>(
    ((storesRes.data ?? []) as { id: string; store_name: string }[]).map((s) => [s.id, s.store_name]),
  );
  const favSet = new Set(((favRes.data ?? []) as { room_id: string }[]).map((f) => f.room_id));

  const memberCount = new Map<string, number>();
  const myRooms = new Set<string>();
  for (const m of members) {
    memberCount.set(m.room_id, (memberCount.get(m.room_id) ?? 0) + 1);
    if (m.user_id === user.id) myRooms.add(m.room_id);
  }

  const counts = new Map<string, { pending: number; in_progress: number; done: number }>();
  const roomHasAll = new Set<string>();
  const roomBranches = new Map<string, Set<string>>();
  for (const t of tasks) {
    const c = counts.get(t.room_id) ?? { pending: 0, in_progress: 0, done: 0 };
    if (t.status === 'pending_approval') c.pending += 1;
    else if (t.status === 'in_progress') c.in_progress += 1;
    else if (t.status === 'done') c.done += 1;
    counts.set(t.room_id, c);

    if (!t.store_id) {
      roomHasAll.add(t.room_id); // มีงานข้ามสาขา → แสดงแค่ "ทุกสาขา"
    } else {
      const name = storeMap.get(t.store_id);
      if (name) {
        const set = roomBranches.get(t.room_id) ?? new Set<string>();
        set.add(name);
        roomBranches.set(t.room_id, set);
      }
    }
  }

  const result: TaskRoomWithStats[] = rooms.map((r) => {
    const c = counts.get(r.id) ?? { pending: 0, in_progress: 0, done: 0 };
    return {
      ...r,
      members_count: memberCount.get(r.id) ?? 0,
      pending: c.pending,
      in_progress: c.in_progress,
      done: c.done,
      is_member: myRooms.has(r.id),
      branches: [...(roomBranches.get(r.id) ?? [])], // ชื่อสาขาจริง (ไม่ยุบ) — ใช้กรอง
      has_all_branch: roomHasAll.has(r.id), // มีงานข้ามสาขา — ใช้แสดง "ทุกสาขา"
      is_favorite: favSet.has(r.id),
    };
  });

  return NextResponse.json({ rooms: result });
}

// POST /api/tasks/rooms — create a room (owner only)
export async function POST(request: NextRequest) {
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
    return NextResponse.json({ error: 'เฉพาะเจ้าของร้านเท่านั้นที่สร้างห้องได้' }, { status: 403 });
  }

  let body: CreateRoomBody;
  try {
    body = (await request.json()) as CreateRoomBody;
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: 'กรุณาระบุชื่อห้อง' }, { status: 400 });

  const insert: Record<string, unknown> = {
    name,
    description: body.description?.trim() || null,
    icon: body.icon?.trim() || 'clipboard-list',
    color: body.color?.trim() || 'indigo',
    ticket_prefix: body.ticketPrefix?.trim() || 'TR',
    created_by: user.id,
  };
  // ── คอนฟิกโฟลงาน (00059) — ใส่เฉพาะเมื่อส่งมา (ที่เหลือใช้ default ของ DB) ──
  if (ASSIGN_MODES.includes(body.assignMode as TaskAssignMode)) insert.assign_mode = body.assignMode;
  if (RESPONSE_TYPES.includes(body.defaultResponseType as TaskResponseType))
    insert.default_response_type = body.defaultResponseType;
  if (body.responsibleTarget) insert.responsible_target = sanitizeTarget(body.responsibleTarget);
  if (body.creatorTarget) insert.creator_target = sanitizeTarget(body.creatorTarget);
  if (typeof body.requireAttachmentDefault === 'boolean')
    insert.require_attachment_default = body.requireAttachmentDefault;

  // กันไม่ให้ responsible_target ค้างเป็น 'manual' ตอน assign_mode เป็น claim/all
  // (ไม่งั้น resolveTargetUserIds คืน 0 คนแบบเงียบ ๆ — งานเปิดมาไม่มีใครรับ/เห็นได้เลย)
  const effAssignMode = (insert.assign_mode as TaskAssignMode | undefined) ?? 'manual';
  const effRespTarget = insert.responsible_target as TaskTarget | undefined;
  if (effAssignMode !== 'manual' && (!effRespTarget || effRespTarget.mode === 'manual')) {
    insert.responsible_target = { mode: 'everyone' } as TaskTarget;
  }

  const { data: room, error } = await supabase
    .from('task_rooms')
    .insert(insert)
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Always add the owner + any selected members
  const memberIds = [...new Set([user.id, ...(body.memberUserIds ?? [])])].filter(Boolean);
  if (memberIds.length > 0) {
    await supabase.from('task_room_members').insert(
      memberIds.map((uid) => ({
        room_id: room.id,
        user_id: uid,
        role: uid === user.id ? 'manager' : 'member',
        added_by: user.id,
      })),
    );
  }

  return NextResponse.json({ room });
}
