import { createServiceClient } from '@/lib/supabase/server';
import type { TaskTarget } from '@/types/tasks';

const STAFF_ROLES = ['owner', 'accountant', 'manager', 'bar', 'head_bar', 'technician', 'staff'];

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
  if (!target || target.mode === 'everyone') return true;
  // mode='manual' หมายถึง "ยังไม่ได้ตั้งกลุ่มเป้าหมาย" — resolveTargetUserIds คืน [] (ไม่มีใครตรง)
  // เพื่อความสอดคล้อง (fail-closed) ต้องคืน false ที่นี่ด้วย ไม่ใช่ผ่านให้ทุกคนแบบไม่มีเงื่อนไข
  if (target.mode === 'manual') return false;
  const ids = await resolveTargetUserIds(target);
  return ids.includes(userId);
}

export interface ClaimableCandidate {
  id: string;
  room_id: string;
  status: string;
  assigneeCount: number;
  openClaim: boolean;
}

/**
 * จากรายการงาน (ทุกสถานะ) คืนชุด task id ที่ "เปิดให้รับ" (claim) และผู้ใช้คนนี้
 * ตรงกับ responsible_target ของห้องนั้น — ใช้แสดง badge/ป้าย "รอคุณรับ" ทั้งในหน้ารายการ
 * งานและตัวนับรวมบน sidebar โดยไม่ต้องเขียน logic เทียบกลุ่มเป้าหมายซ้ำที่อื่น
 */
export async function getClaimableTaskIds(
  candidates: ClaimableCandidate[],
  userId: string,
): Promise<Set<string>> {
  const openCandidates = candidates.filter(
    (c) => c.status === 'in_progress' && c.assigneeCount === 0 && c.openClaim,
  );
  if (openCandidates.length === 0) return new Set();

  const roomIds = [...new Set(openCandidates.map((c) => c.room_id))];
  const supabase = createServiceClient();
  const { data: rooms } = await supabase
    .from('task_rooms')
    .select('id, responsible_target')
    .in('id', roomIds);
  const targetByRoom = new Map(
    (rooms ?? []).map((r) => [r.id as string, r.responsible_target as TaskTarget | null]),
  );

  const matchByRoom = new Map<string, boolean>();
  for (const roomId of roomIds) {
    matchByRoom.set(roomId, await userMatchesTarget(userId, targetByRoom.get(roomId) ?? null));
  }

  const result = new Set<string>();
  for (const c of openCandidates) {
    if (matchByRoom.get(c.room_id)) result.add(c.id);
  }
  return result;
}
