import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { getClaimableTaskIds } from '@/lib/tasks/resolve-target';

// GET /api/tasks/my-count — จำนวนงานที่ต้องการความสนใจจากผู้ใช้คนนี้ (ขับ badge บน sidebar)
// = งานที่มอบหมายให้ตัวเองแล้วแต่ยังไม่ได้ตอบกลับ (assign) + งานเปิดให้รับที่ตรงกลุ่มเป้าหมาย (claim)
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const svc = createServiceClient();

  const [{ data: myAssignRows }, { data: openClaimTasks }] = await Promise.all([
    supabase
      .from('task_assignees')
      .select('task_id, state, task:tasks!inner(status)')
      .eq('user_id', user.id)
      .eq('task.status', 'in_progress'),
    svc
      .from('tasks')
      .select('id, room_id, assignees:task_assignees(id)')
      .eq('status', 'in_progress')
      .contains('meta', { open_claim: true }),
  ]);

  const assignedCount = new Set(
    (myAssignRows ?? [])
      .filter((r) => r.state !== 'submitted' && r.state !== 'done')
      .map((r) => r.task_id),
  ).size;

  const claimableIds = await getClaimableTaskIds(
    (openClaimTasks ?? []).map((t) => ({
      id: t.id,
      room_id: t.room_id,
      status: 'in_progress',
      assigneeCount: (t.assignees ?? []).length,
      openClaim: true,
    })),
    user.id,
  );

  return NextResponse.json({ count: assignedCount + claimableIds.size });
}
