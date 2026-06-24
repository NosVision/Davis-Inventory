import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// PATCH /api/tasks/recurrences/[id] — toggle active / edit (owner; RLS enforces)
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

  let body: Partial<{ active: boolean; title: string; detail: string; remindEveryDays: number | null }>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if (typeof body.active === 'boolean') update.active = body.active;
  if (typeof body.title === 'string') update.title = body.title.trim();
  if (typeof body.detail === 'string') update.detail = body.detail.trim() || null;
  if ('remindEveryDays' in body) update.remind_every_days = body.remindEveryDays ?? null;
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'ไม่มีข้อมูลที่จะแก้ไข' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('task_recurrences')
    .update(update)
    .eq('id', id)
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ recurrence: data });
}

// DELETE /api/tasks/recurrences/[id] — delete template (owner; generated tasks keep, recurrence_id -> null)
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { error } = await supabase.from('task_recurrences').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
