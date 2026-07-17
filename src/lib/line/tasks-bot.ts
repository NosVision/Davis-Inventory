import { createServiceClient } from '@/lib/supabase/server';
import { pushMessage, type LineMessage } from '@/lib/line/messaging';

// Central "task bot" — a LINE channel used ONLY by the Task Room system (separate from the
// per-store customer OAs). Its credentials live in system_settings so no env/central customer
// token is resurrected. Push-only: it fires task events into LINE groups; the only inbound event
// it handles is the one-time "groupid" capture (see /api/line/tasks/webhook).
export const TASK_BOT_TOKEN_KEY = 'tasks.line_bot_token';
export const TASK_BOT_SECRET_KEY = 'tasks.line_bot_secret';

export interface TaskBotConfig {
  token: string | null;
  secret: string | null;
}

export async function getTaskBotConfig(): Promise<TaskBotConfig> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('system_settings')
    .select('key, value')
    .in('key', [TASK_BOT_TOKEN_KEY, TASK_BOT_SECRET_KEY]);
  const map = new Map((data ?? []).map((r) => [r.key as string, (r.value as string | null) ?? '']));
  return {
    token: (map.get(TASK_BOT_TOKEN_KEY) || '').trim() || null,
    secret: (map.get(TASK_BOT_SECRET_KEY) || '').trim() || null,
  };
}

/** Push messages to a LINE group via the central task bot. No-op (false) if the bot is unconfigured. */
export async function pushTaskLineGroup(groupId: string, messages: LineMessage[]): Promise<boolean> {
  if (!groupId) return false;
  const { token } = await getTaskBotConfig();
  if (!token) return false;
  try {
    await pushMessage(groupId, messages, { token });
    return true;
  } catch (error) {
    console.error('[tasks/line] group push failed:', error);
    return false;
  }
}
