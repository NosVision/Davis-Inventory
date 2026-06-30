import { createClient } from '@/lib/supabase/server';

// จัดการคอนฟิก POS (โต๊ะ/โซน/เมนู) = เจ้าของ/ผู้จัดการ
export const POS_MANAGER_ROLES = ['owner', 'manager'];

export async function getPosContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, role: null as string | null };
  const { data: p } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  return { supabase, user, role: ((p as { role?: string } | null)?.role ?? null) as string | null };
}

export function isPosManager(role: string | null): boolean {
  return !!role && POS_MANAGER_ROLES.includes(role);
}
