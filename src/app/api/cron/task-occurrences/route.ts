import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { notifyTaskUsers } from '@/lib/tasks/notify';
import { todayBangkok } from '@/lib/utils/date';

/**
 * Cron: generate recurring task occurrences forward + remind assignees of tasks due today.
 * Schedule daily. Auth via CRON_SECRET (same pattern as other crons).
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const today = todayBangkok();

  // 1) Top up recurring occurrences (idempotent)
  const { data: generated, error: genErr } = await supabase.rpc('generate_task_occurrences');
  if (genErr) {
    return NextResponse.json({ error: genErr.message }, { status: 500 });
  }

  // 2) Activate scheduled tasks whose start date has arrived (notify, then flip to in_progress)
  const { data: starting } = await supabase
    .from('tasks')
    .select('id, room_id, ticket_no, title, store_id, assignees:task_assignees(user_id)')
    .eq('status', 'scheduled')
    .lte('start_date', today)
    .limit(500);

  for (const t of (starting ?? []) as Array<{
    id: string; room_id: string; ticket_no: string; title: string; store_id: string | null;
    assignees: { user_id: string }[];
  }>) {
    const userIds = (t.assignees ?? []).map((a) => a.user_id);
    if (userIds.length === 0) continue;
    await notifyTaskUsers({
      userIds,
      storeId: t.store_id,
      type: 'task_assigned',
      title: '🚀 ถึงวันเริ่มงานแล้ว',
      body: `${t.ticket_no} · ${t.title}`,
      data: { taskId: t.id, roomId: t.room_id, url: `/tasks/${t.room_id}` },
    });
  }
  const activated = starting?.length ?? 0;
  if (activated > 0) {
    await supabase.from('tasks').update({ status: 'in_progress' }).eq('status', 'scheduled').lte('start_date', today);
  }

  // 3) Remind assignees of tasks due today and still open
  const { data: due } = await supabase
    .from('tasks')
    .select('id, room_id, ticket_no, title, store_id, status, due_date, assignees:task_assignees(user_id)')
    .eq('due_date', today)
    .eq('status', 'in_progress')
    .limit(500);

  let reminded = 0;
  for (const t of (due ?? []) as Array<{
    id: string; room_id: string; ticket_no: string; title: string; store_id: string | null;
    assignees: { user_id: string }[];
  }>) {
    const userIds = (t.assignees ?? []).map((a) => a.user_id);
    if (userIds.length === 0) continue;
    await notifyTaskUsers({
      userIds,
      storeId: t.store_id,
      type: 'task_assigned',
      title: '⏰ งานครบกำหนดวันนี้',
      body: `${t.ticket_no} · ${t.title}`,
      data: { taskId: t.id, roomId: t.room_id, url: `/tasks/${t.room_id}` },
    });
    reminded += 1;
  }

  return NextResponse.json({ status: 'ok', generated: generated ?? 0, activated, reminded });
}
