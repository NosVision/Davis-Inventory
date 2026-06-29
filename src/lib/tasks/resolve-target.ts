import { createServiceClient } from '@/lib/supabase/server';
import type { TaskTarget } from '@/types/tasks';

const STAFF_ROLES = ['owner', 'accountant', 'manager', 'bar', 'technician', 'staff'];

/**
 * แปลง TaskTarget → รายชื่อ user id ที่ active (server-only, ใช้ service client)
 * - manual → [] (ระบุผู้รับผิดชอบรายงานเอง)
 * - users  → userIds ที่ระบุ
 * - everyone → พนักงาน active ทั้งหมด
 * - roles  → พนักงานตามตำแหน่ง (ตัดด้วยสาขาได้ถ้ามี storeIds)
 * - stores → พนักงาน active ในสาขาที่เลือก
 */
export async function resolveTargetUserIds(
  target: TaskTarget | null | undefined,
): Promise<string[]> {
  if (!target || target.mode === 'manual') return [];
  const supabase = createServiceClient();

  if (target.mode === 'users') {
    return [...new Set((target.userIds ?? []).filter(Boolean))];
  }

  const storeIds = (target.storeIds ?? []).filter(Boolean);

  const roles =
    target.mode === 'roles' && (target.roles ?? []).length > 0
      ? target.roles!.filter((r) => STAFF_ROLES.includes(r))
      : STAFF_ROLES;

  const { data: profs } = await supabase
    .from('profiles')
    .select('id')
    .eq('active', true)
    .in('role', roles);
  let ids = (profs ?? []).map((p) => p.id);

  // ตัดด้วยสาขา: โหมด stores เสมอ หรือ ตำแหน่ง+ระบุสาขา
  if (target.mode === 'stores' || storeIds.length > 0) {
    if (storeIds.length === 0) return [];
    const { data: us } = await supabase
      .from('user_stores')
      .select('user_id')
      .in('store_id', storeIds);
    const inStores = new Set((us ?? []).map((r) => r.user_id));
    ids = ids.filter((id) => inStores.has(id));
  }

  return [...new Set(ids)].filter(Boolean);
}

/** ผู้ใช้ตรงกับกลุ่มเป้าหมายไหม (สำหรับเช็คสิทธิ์เปิดเรื่อง) */
export async function userMatchesTarget(
  userId: string,
  target: TaskTarget | null | undefined,
): Promise<boolean> {
  if (!target || target.mode === 'everyone' || target.mode === 'manual') return true;
  const ids = await resolveTargetUserIds(target);
  return ids.includes(userId);
}
