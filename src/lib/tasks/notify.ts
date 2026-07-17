import { createServiceClient } from '@/lib/supabase/server';
import { sendPushToUser, type PushPayload } from '@/lib/notifications/push';
import { pushTaskLineGroup } from '@/lib/line/tasks-bot';
import { taskNotifyFlex } from '@/lib/line/flex-templates';
import { getRoomColor } from '@/lib/tasks/colors';
import type { LineMessage } from '@/lib/line/messaging';

/**
 * แจ้งเตือนงาน (Task Management) — เฉพาะ in-app + web push เท่านั้น
 * ตั้งใจ "ไม่มี LINE" สำหรับฟีเจอร์นี้ (จึงไม่เรียก service.ts / notifyUserWithLine)
 */

export type TaskNotificationType =
  | 'task_assigned'
  | 'task_approval_request'
  | 'task_approved'
  | 'task_rejected'
  | 'task_completed';

interface NotifyTaskUsersParams {
  userIds: string[];
  storeId?: string | null;
  type: TaskNotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  excludeUserId?: string;
}

interface PrefRow {
  user_id: string;
  pwa_enabled: boolean | null;
  notify_task: boolean | null;
}

/** ส่งแจ้งเตือนงานให้ผู้ใช้หลายคน (in-app + web push, ไม่มี LINE) */
export async function notifyTaskUsers(params: NotifyTaskUsersParams): Promise<void> {
  const { userIds, storeId, type, title, body, data, excludeUserId } = params;
  const targets = [...new Set(userIds)].filter((id) => !!id && id !== excludeUserId);
  if (targets.length === 0) return;

  try {
    const supabase = createServiceClient();

    // 1) in-app — insert เสมอ
    const rows = targets.map((userId) => ({
      user_id: userId,
      store_id: storeId ?? null,
      title,
      body,
      type,
      read: false,
      data: data ?? null,
    }));
    const { error } = await supabase.from('notifications').insert(rows);
    if (error) console.error('[tasks] notify insert error:', error.message);

    // 2) web push — ตาม preference (notify_task + pwa_enabled)
    const { data: prefs } = await supabase
      .from('notification_preferences')
      .select('user_id, pwa_enabled, notify_task')
      .in('user_id', targets);
    const prefMap = new Map((prefs as PrefRow[] | null ?? []).map((p) => [p.user_id, p]));

    const payload: PushPayload = {
      title,
      body,
      url: data?.url as string | undefined,
      data,
    };

    await Promise.allSettled(
      targets.map((userId) => {
        const p = prefMap.get(userId);
        const typeOn = p ? p.notify_task !== false : true;
        const pwaOn = p ? p.pwa_enabled !== false : true;
        if (!typeOn || !pwaOn) return Promise.resolve();
        return sendPushToUser(userId, payload);
      }),
    );
  } catch (error) {
    console.error('[tasks] notifyTaskUsers error:', error);
  }
}

interface TaskLineGroupParams {
  /** Header line, e.g. "📋 มีงานใหม่" */
  headline: string;
  ticketNo: string;
  title: string;
  detail?: string | null;
  assigneeText?: string | null;
  dueText?: string | null;
}

/**
 * แจ้งเตือนเข้ากลุ่ม LINE ของห้องงาน (ผ่านบอทกลาง) เป็น Flex card — เฉพาะเมื่อห้องเปิด
 * line_notify_enabled และตั้ง group id ไว้. เงียบเสมอเมื่อไม่ได้ตั้งค่า (ไม่ throw).
 * ปุ่ม "เปิดดูงาน" ลิงก์เข้าห้องงาน (ต้องมี NEXT_PUBLIC_APP_URL ถึงจะมีปุ่ม).
 */
export async function notifyTaskLineGroup(roomId: string, params: TaskLineGroupParams): Promise<void> {
  try {
    const supabase = createServiceClient();
    const { data: room } = await supabase
      .from('task_rooms')
      .select('name, color, line_notify_enabled, line_group_id')
      .eq('id', roomId)
      .maybeSingle();
    const groupId = room?.line_group_id as string | null;
    if (!room?.line_notify_enabled || !groupId) return;

    const base = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '');
    const flex = taskNotifyFlex({
      headline: params.headline,
      roomName: (room.name as string) || 'ห้องงาน',
      ticketNo: params.ticketNo,
      title: params.title,
      detail: params.detail ?? null,
      assigneeText: params.assigneeText ?? null,
      dueText: params.dueText ?? null,
      url: base ? `${base}/tasks/${roomId}` : null,
      accent: getRoomColor(room.color as string | null).accent,
    });
    await pushTaskLineGroup(groupId, [flex as unknown as LineMessage]);
  } catch (error) {
    console.error('[tasks] notifyTaskLineGroup error:', error);
  }
}

/** หา user ids ในห้อง (กรองตาม role ได้) — สำหรับแจ้งเตือนกลุ่ม */
export async function getRoomMemberIds(
  roomId: string,
  opts?: { roles?: string[] },
): Promise<string[]> {
  try {
    const supabase = createServiceClient();
    let q = supabase
      .from('task_room_members')
      .select('user_id, profiles!inner(role)')
      .eq('room_id', roomId);
    if (opts?.roles && opts.roles.length > 0) {
      q = q.in('profiles.role', opts.roles);
    }
    const { data } = await q;
    return (data as { user_id: string }[] | null ?? []).map((r) => r.user_id);
  } catch {
    return [];
  }
}
