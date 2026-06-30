import { createClient } from '@/lib/supabase/server';

// ตำแหน่งฝั่งจัดการ/HQ ที่แก้ catalog/PO ได้
export const INV_MGMT_ROLES = ['owner', 'manager', 'accountant'];

/** สร้าง client + ดึง user + role ครั้งเดียว ใช้ซ้ำในทุก route ของโมดูลสต๊อก */
export async function getInvContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, role: null as string | null };
  const { data: p } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  return { supabase, user, role: ((p as { role?: string } | null)?.role ?? null) as string | null };
}

export function isInvMgmt(role: string | null): boolean {
  return !!role && INV_MGMT_ROLES.includes(role);
}
