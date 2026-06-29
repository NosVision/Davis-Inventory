import type { TaskTarget, TaskTargetMode } from '@/types/tasks';

const MODES: TaskTargetMode[] = ['manual', 'everyone', 'stores', 'roles', 'users'];

const cleanIds = (v: unknown): string[] | undefined => {
  if (!Array.isArray(v)) return undefined;
  const out = [...new Set(v.filter((x): x is string => typeof x === 'string' && x.length > 0))];
  return out.length > 0 ? out : undefined;
};

/**
 * ทำความสะอาด/ตรวจ TaskTarget ที่รับมาจาก client ก่อนเก็บลง jsonb
 * ค่าเริ่มต้น mode = 'everyone' ถ้าค่าที่ส่งมาไม่ถูกต้อง
 */
export function sanitizeTarget(input: unknown): TaskTarget {
  const o = (input ?? {}) as Record<string, unknown>;
  const mode: TaskTargetMode = MODES.includes(o.mode as TaskTargetMode)
    ? (o.mode as TaskTargetMode)
    : 'everyone';

  const target: TaskTarget = { mode };
  const storeIds = cleanIds(o.storeIds);
  const roles = cleanIds(o.roles);
  const userIds = cleanIds(o.userIds);
  if (storeIds) target.storeIds = storeIds;
  if (roles) target.roles = roles;
  if (userIds) target.userIds = userIds;
  return target;
}
