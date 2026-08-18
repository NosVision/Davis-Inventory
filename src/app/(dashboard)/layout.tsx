import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { isDesktopRole } from '@/lib/auth/permissions';
import type { UserRole } from '@/types/roles';
import type { Store, UserPermission } from '@/types/database';
import type { Permission } from '@/types/roles';
import { DashboardLayoutClient } from './layout-client';
import { PasswordChangeBanner } from '@/components/layout/password-change-banner';
import { IdentityClaimModal } from '@/components/hr/identity-claim-modal';
import { PolicyGate } from '@/components/hr/policy-gate';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  // ดึงข้อมูลผู้ใช้จาก Supabase Auth
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) {
    redirect('/login');
  }

  // ดึงโปรไฟล์ผู้ใช้
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', authUser.id)
    .single();

  if (!profile || !profile.active) {
    redirect('/login');
  }

  // ดึงร้านที่ผู้ใช้สังกัด
  const { data: userStores } = await supabase
    .from('user_stores')
    .select('store_id')
    .eq('user_id', authUser.id);

  const storeIds = (userStores ?? []).map((us: { store_id: string }) => us.store_id);

  // ร้านที่ผู้ใช้ "ดูแล" (hr_manager_scopes) — คนละอย่างกับร้านที่สังกัด. Drives the nav gate for
  // scheduling + venue approvals, which are per-user grants rather than roles. RLS lets a user
  // read their own scope rows.
  const { data: managedScopes } = await supabase
    .from('hr_manager_scopes')
    .select('store_id, can_schedule, can_approve')
    .eq('user_id', authUser.id);
  type ScopeRow = { store_id: string; can_schedule: boolean; can_approve: boolean };
  const scopeRows = (managedScopes ?? []) as ScopeRow[];
  const managedStoreIds = scopeRows.map((s) => s.store_id);
  // Split, so the nav can ask which half a module needs (00187). A captain holds the roster only,
  // and used to be shown an approvals entry that bounced them straight back out.
  const managedScheduleStoreIds = scopeRows.filter((s) => s.can_schedule).map((s) => s.store_id);
  const managedApproveStoreIds = scopeRows.filter((s) => s.can_approve).map((s) => s.store_id);

  // ดึงข้อมูลร้านค้า
  //
  // `hr_only` venues are excluded here on purpose. The OFFICE venue exists so office staff can be
  // rostered and clock in; it trades nothing, so offering it in the venue switcher — and through it
  // to stock, POS and every venue-scoped page — invites counts and orders against a place that
  // cannot have them. Someone whose only venue is the office therefore sees what a user with no
  // venue sees, which is the behaviour asked for. HR's own pages query stores directly and still
  // list it (owner ask 2026-08-18).
  let stores: Store[] = [];
  if (profile.role === 'owner' || profile.role === 'accountant' || profile.role === 'hq' || profile.role === 'hr') {
    // เจ้าของ / บัญชี / คลังกลาง / ฝ่ายบุคคล เห็นทุกสาขา (hr เป็น role ข้ามสาขา ไม่ผูกกับ user_stores)
    const { data } = await supabase
      .from('stores')
      .select('*')
      .eq('active', true)
      .eq('hr_only', false)
      .order('store_name');
    stores = data ?? [];
  } else if (storeIds.length > 0) {
    const { data } = await supabase
      .from('stores')
      .select('*')
      .in('id', storeIds)
      .eq('active', true)
      .eq('hr_only', false)
      .order('store_name');
    stores = data ?? [];
  }

  // ดึง permissions พิเศษ
  const { data: extraPermissions } = await supabase
    .from('user_permissions')
    .select('permission')
    .eq('user_id', authUser.id);

  const permissions = (extraPermissions ?? []).map(
    (p: Pick<UserPermission, 'permission'>) => p.permission as Permission
  );

  // สร้าง AuthUser object สำหรับส่งไป client
  const serializedUser = {
    id: authUser.id,
    username: profile.username,
    role: profile.role as UserRole,
    permissions,
    storeIds,
    managedStoreIds,
    managedScheduleStoreIds,
    managedApproveStoreIds,
    lineUserId: profile.line_user_id,
    displayName: profile.display_name,
    avatarUrl: profile.avatar_url,
  };

  const useDesktop = isDesktopRole(profile.role as UserRole);

  return (
    <DashboardLayoutClient
      user={serializedUser}
      stores={stores}
      useDesktop={useDesktop}
    >
      {profile.must_change_password && <PasswordChangeBanner />}
      <IdentityClaimModal role={profile.role as string} />
      <PolicyGate role={profile.role as string} />
      {children}
    </DashboardLayoutClient>
  );
}
