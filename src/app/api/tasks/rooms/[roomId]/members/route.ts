import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { TaskRoomMember } from '@/types/tasks';

const MEMBER_SELECT =
  '*, profile:profiles!task_room_members_user_id_fkey(id, display_name, username, avatar_url, role)';

const STAFF_ROLES = ['owner', 'accountant', 'manager', 'bar', 'head_bar', 'technician', 'staff'];

type Scope = 'everyone' | 'people' | 'branch' | 'role';
interface AddBody {
  scope: Scope;
  userIds?: string[];
  storeIds?: string[];
  roles?: string[];
}

// GET /api/tasks/rooms/[roomId]/members
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

  const { data, error } = await supabase
    .from('task_room_members')
    .select(MEMBER_SELECT)
    .eq('room_id', roomId)
    .order('joined_at', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ members: (data ?? []) as TaskRoomMember[] });
}

// POST /api/tasks/rooms/[roomId]/members — add members by scope (owner only)
export async function POST(
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
    return NextResponse.json({ error: 'เฉพาะเจ้าของร้านเท่านั้นที่ดึงสมาชิกได้' }, { status: 403 });
  }

  let body: AddBody;
  try {
    body = (await request.json()) as AddBody;
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  // Resolve scope -> concrete user ids
  let userIds: string[] = [];
  if (body.scope === 'people') {
    userIds = body.userIds ?? [];
  } else if (body.scope === 'everyone') {
    const { data } = await supabase
      .from('profiles')
      .select('id')
      .eq('active', true)
      .in('role', STAFF_ROLES);
    userIds = (data ?? []).map((p) => p.id);
  } else if (body.scope === 'role') {
    const roles = (body.roles ?? []).filter((r) => STAFF_ROLES.includes(r));
    if (roles.length > 0) {
      const { data } = await supabase
        .from('profiles')
        .select('id')
        .eq('active', true)
        .in('role', roles);
      userIds = (data ?? []).map((p) => p.id);
    }
  } else if (body.scope === 'branch') {
    const storeIds = body.storeIds ?? [];
    if (storeIds.length > 0) {
      const { data } = await supabase
        .from('user_stores')
        .select('user_id')
        .in('store_id', storeIds);
      userIds = [...new Set((data ?? []).map((r) => r.user_id))];
    }
  }

  userIds = [...new Set(userIds)].filter(Boolean);
  if (userIds.length === 0) {
    return NextResponse.json({ error: 'ไม่พบพนักงานตามเงื่อนไขที่เลือก' }, { status: 400 });
  }

  const { error } = await supabase.from('task_room_members').upsert(
    userIds.map((uid) => ({ room_id: roomId, user_id: uid, added_by: user.id })),
    { onConflict: 'room_id,user_id', ignoreDuplicates: true },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: members } = await supabase
    .from('task_room_members')
    .select(MEMBER_SELECT)
    .eq('room_id', roomId)
    .order('joined_at', { ascending: true });

  return NextResponse.json({ members: (members ?? []) as TaskRoomMember[] });
}

// PATCH /api/tasks/rooms/[roomId]/members — change a member's role (owner only)
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

  let body: { userId?: string; role?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  if (!body.userId || !['member', 'manager'].includes(body.role ?? '')) {
    return NextResponse.json({ error: 'ระบุ userId และบทบาทให้ถูกต้อง' }, { status: 400 });
  }

  const { error } = await supabase
    .from('task_room_members')
    .update({ role: body.role })
    .eq('room_id', roomId)
    .eq('user_id', body.userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

// DELETE /api/tasks/rooms/[roomId]/members — remove a member (owner only)
export async function DELETE(
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

  let userId: string | undefined;
  try {
    ({ userId } = await request.json());
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  if (!userId) return NextResponse.json({ error: 'ระบุ userId' }, { status: 400 });

  const { error } = await supabase
    .from('task_room_members')
    .delete()
    .eq('room_id', roomId)
    .eq('user_id', userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
