'use client';

import { useTranslations } from 'next-intl';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils/cn';
import { useAuthStore } from '@/stores/auth-store';
import {
  Button,
  Badge,
  Card,
  Input,
  Modal,
  ModalFooter,
  Select,
  EmptyState,
  toast,
} from '@/components/ui';
import { formatThaiDate } from '@/lib/utils/format';
import { ROLE_LABELS } from '@/types/roles';
import type { UserRole } from '@/types/roles';
import {
  Users,
  Plus,
  Search,
  Shield,
  UserCheck,
  UserX,
  Store,
  Mail,
  KeyRound,
  Clock,
  Copy,
} from 'lucide-react';

function formatLastSignIn(iso: string | null): string {
  if (!iso) return 'ยังไม่เคยเข้าใช้';
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'เพิ่งเข้าใช้';
  if (min < 60) return `${min} นาทีที่แล้ว`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} ชั่วโมงที่แล้ว`;
  const days = Math.floor(hr / 24);
  if (days < 30) return `${days} วันที่แล้ว`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} เดือนที่แล้ว`;
  return `${Math.floor(months / 12)} ปีที่แล้ว`;
}

interface UserProfile {
  id: string;
  username: string;
  role: UserRole;
  display_name: string | null;
  active: boolean;
  created_at: string;
  line_user_id: string | null;
  last_sign_in_at: string | null;
  stores: Array<{ store_id: string; store: { store_name: string } }>;
}

interface StoreOption {
  id: string;
  store_name: string;
}

const roleBadgeVariants: Record<string, 'info' | 'success' | 'warning' | 'danger' | 'default'> = {
  owner: 'danger',
  accountant: 'info',
  manager: 'warning',
  bar: 'success',
  staff: 'default',
  customer: 'default',
};

export default function UsersPage() {
  const { user: currentUser } = useAuthStore();
  const t = useTranslations('users');
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [storeEditUser, setStoreEditUser] = useState<UserProfile | null>(null);
  const [editStoreIds, setEditStoreIds] = useState<string[]>([]);
  const [savingStores, setSavingStores] = useState(false);
  const [filterStoreId, setFilterStoreId] = useState<string>('all');
  const [filterRole, setFilterRole] = useState<string>('all');
  const [filterLinked, setFilterLinked] = useState<'all' | 'linked' | 'unlinked'>('all');
  const [linkedIds, setLinkedIds] = useState<Set<string>>(new Set());
  const [resetTarget, setResetTarget] = useState<UserProfile | null>(null);
  const [resetResult, setResetResult] = useState<{ username: string; password: string } | null>(null);
  const [isResetting, setIsResetting] = useState(false);

  // Create form
  const [formUsername, setFormUsername] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formRole, setFormRole] = useState<string>('staff');
  const [formDisplayName, setFormDisplayName] = useState('');
  const [formStoreIds, setFormStoreIds] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadUsers = useCallback(async () => {
    setIsLoading(true);
    const supabase = createClient();
    const [{ data }, { data: emps }] = await Promise.all([
      supabase
        .from('profiles')
        .select('*, stores:user_stores(store_id, store:stores(store_name))')
        .neq('role', 'customer')
        .order('created_at', { ascending: false }),
      // Which profiles are linked to a real employee record — readable by owner/HR (this
      // page's audience) through hr_employees RLS. Drives the "ผูกบัญชีแล้ว" indicator + filter.
      supabase.from('hr_employees').select('profile_id'),
    ]);

    if (data) setUsers(data as unknown as UserProfile[]);
    setLinkedIds(new Set((emps ?? []).map((e: { profile_id: string }) => e.profile_id as string)));
    setIsLoading(false);
  }, []);

  const loadStores = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from('stores')
      .select('id, store_name')
      .eq('active', true)
      .order('store_name');
    if (data) setStores(data);
  }, []);

  useEffect(() => {
    loadUsers();
    loadStores();
  }, [loadUsers, loadStores]);

  const handleCreateUser = async () => {
    if (!formUsername || !formPassword || !currentUser) return;

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/auth/create-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: formUsername.trim(),
          password: formPassword,
          role: formRole,
          displayName: formDisplayName.trim() || null,
          storeIds: formStoreIds,
        }),
      });

      const result = await res.json();

      if (!res.ok) {
        toast({ type: 'error', title: t('error'), message: result.error || t('createFailed') });
      } else {
        toast({ type: 'success', title: t('createSuccess') });
        setShowCreateModal(false);
        resetForm();
        loadUsers();
      }
    } catch {
      toast({ type: 'error', title: t('networkError') });
    }
    setIsSubmitting(false);
  };

  const handleResetPassword = async () => {
    if (!resetTarget) return;
    setIsResetting(true);
    try {
      const res = await fetch(`/api/users/${resetTarget.id}/reset-password`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        toast({ type: 'error', title: 'รีเซ็ตรหัสผ่านไม่สำเร็จ', message: data.error });
        setResetTarget(null);
      } else {
        setResetResult({ username: data.username, password: data.password });
      }
    } catch {
      toast({ type: 'error', title: t('networkError') });
      setResetTarget(null);
    }
    setIsResetting(false);
  };

  const toggleUserActive = async (userId: string, currentActive: boolean) => {
    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !currentActive }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ type: 'error', title: t('error'), message: json.error });
        return;
      }
      toast({ type: 'success', title: currentActive ? t('deactivated') : t('activated') });
      loadUsers();
    } catch {
      toast({ type: 'error', title: t('networkError') });
    }
  };

  const resetForm = () => {
    setFormUsername('');
    setFormPassword('');
    setFormRole('staff');
    setFormDisplayName('');
    setFormStoreIds([]);
  };

  const openStoreEditor = (u: UserProfile) => {
    setStoreEditUser(u);
    setEditStoreIds(u.stores?.map((s) => s.store_id) ?? []);
  };

  const handleSaveStores = async () => {
    if (!storeEditUser) return;
    setSavingStores(true);
    try {
      const res = await fetch(`/api/users/${storeEditUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeIds: editStoreIds }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || '');
      toast({ type: 'success', title: 'อัปเดตสาขาเรียบร้อย' });
      setStoreEditUser(null);
      loadUsers();
    } catch (err) {
      toast({
        type: 'error',
        title: 'อัปเดตสาขาไม่สำเร็จ',
        message: err instanceof Error ? err.message : '',
      });
    } finally {
      setSavingStores(false);
    }
  };

  const filteredUsers = users.filter((u) => {
    if (
      searchQuery &&
      !u.username.toLowerCase().includes(searchQuery.toLowerCase()) &&
      !u.display_name?.toLowerCase().includes(searchQuery.toLowerCase())
    ) {
      return false;
    }
    if (filterRole !== 'all' && u.role !== filterRole) return false;
    if (filterStoreId !== 'all') {
      const storeIds = u.stores?.map((s) => s.store_id) || [];
      if (!storeIds.includes(filterStoreId)) return false;
    }
    const linked = linkedIds.has(u.id);
    if (filterLinked === 'linked' && !linked) return false;
    if (filterLinked === 'unlinked' && linked) return false;
    return true;
  });

  const FILTERABLE_ROLES: UserRole[] = ['owner', 'accountant', 'manager', 'bar', 'technician', 'staff', 'hq', 'hr'];
  // Owner + HR may administer users; only the OWNER gets the elevated bits — the permissions
  // editor and creating/inviting elevated-role accounts (accountant/manager/hq/hr).
  const isOwner = currentUser?.role === 'owner';
  // HR (non-owner) may only administer non-elevated accounts; owner/accountant/hq stay owner-only.
  const canAdminTarget = (u: UserProfile) => isOwner || !['owner', 'accountant', 'hq'].includes(u.role);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('title')}</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {t('subtitle')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/users/invitations">
            <Button variant="outline" icon={<Mail className="h-4 w-4" />}>
              จัดการลิงก์เชิญ
            </Button>
          </Link>
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setShowCreateModal(true)}>
            {t('addUser')}
          </Button>
        </div>
      </div>

      {/* Search + Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-4 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          />
        </div>
        <select
          value={filterStoreId}
          onChange={(e) => setFilterStoreId(e.target.value)}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
        >
          <option value="all">ทุกสาขา</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.store_name}
            </option>
          ))}
        </select>
        <select
          value={filterRole}
          onChange={(e) => setFilterRole(e.target.value)}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
        >
          <option value="all">ทุกตำแหน่ง</option>
          {FILTERABLE_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r] || r}
            </option>
          ))}
        </select>
        <select
          value={filterLinked}
          onChange={(e) => setFilterLinked(e.target.value as 'all' | 'linked' | 'unlinked')}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
        >
          <option value="all">ทั้งหมด</option>
          <option value="linked">ผูกบัญชีแล้ว</option>
          <option value="unlinked">ยังไม่ผูกบัญชี</option>
        </select>
        {(filterStoreId !== 'all' || filterRole !== 'all' || filterLinked !== 'all') && (
          <button
            type="button"
            onClick={() => {
              setFilterStoreId('all');
              setFilterRole('all');
              setFilterLinked('all');
            }}
            className="rounded-lg border border-transparent px-3 py-2 text-xs text-indigo-600 transition-colors hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-900/20"
          >
            ล้างตัวกรอง
          </button>
        )}
      </div>

      {/* User List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-indigo-600" />
        </div>
      ) : filteredUsers.length === 0 ? (
        <EmptyState
          icon={Users}
          title={t('noUsers')}
          description={t('noUsersDesc')}
        />
      ) : (
        <div className="space-y-2">
          {filteredUsers.map((u) => (
            <Card key={u.id} padding="none">
              <div className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  {/* Avatar */}
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400">
                    {(u.display_name || u.username).charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="text-sm font-medium text-gray-900 dark:text-white">
                        {u.display_name || u.username}
                      </p>
                      <Badge variant={roleBadgeVariants[u.role] || 'default'}>
                        {ROLE_LABELS[u.role] || u.role}
                      </Badge>
                      {!u.active && <Badge variant="danger">{t('disabled')}</Badge>}
                      {linkedIds.has(u.id) ? (
                        <Badge variant="success">
                          <span className="inline-flex items-center gap-1">
                            <UserCheck className="h-3 w-3" />
                            ผูกบัญชีแล้ว
                          </span>
                        </Badge>
                      ) : (
                        <Badge variant="default">ยังไม่ผูกบัญชี</Badge>
                      )}
                    </div>
                    <div
                      className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-gray-500 dark:text-gray-400"
                      title={u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : ''}
                    >
                      <span>@{u.username}</span>
                      {u.stores && u.stores.length > 0 && (
                        <span className="flex items-center gap-0.5">
                          <Store className="h-3 w-3" />
                          {u.stores.map((s) => s.store?.store_name).join(', ')}
                        </span>
                      )}
                      <span className="flex items-center gap-0.5">
                        <Clock className="h-3 w-3" />
                        {formatLastSignIn(u.last_sign_in_at)}
                      </span>
                    </div>
                    {u.username.startsWith('printer-') && (
                      <p className="mt-0.5 text-[10px] italic text-amber-600 dark:text-amber-400">
                        🔒 บัญชีระบบเครื่องพิมพ์ — จัดการผ่านหน้าตั้งค่าเครื่องพิมพ์
                      </p>
                    )}
                  </div>
                </div>

                {/* Actions — owner + HR (user administration APIs allow both) */}
                {u.id !== currentUser?.id && !u.username.startsWith('printer-') && canAdminTarget(u) && (
                  <div className="flex items-center gap-1">
                    {u.role !== 'owner' && u.role !== 'customer' && (
                      <button
                        onClick={() => openStoreEditor(u)}
                        className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600 dark:hover:bg-indigo-900/20 dark:hover:text-indigo-400"
                        title="จัดการสาขา"
                      >
                        <Store className="h-4 w-4" />
                      </button>
                    )}
                    {isOwner && u.role !== 'owner' && u.role !== 'customer' && (
                      <Link
                        href={`/users/${u.id}/permissions`}
                        className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-orange-50 hover:text-orange-600 dark:hover:bg-orange-900/20 dark:hover:text-orange-400"
                        title={t('managePermissions')}
                      >
                        <Shield className="h-4 w-4" />
                      </Link>
                    )}
                    {u.role !== 'customer' && (
                      <button
                        onClick={() => setResetTarget(u)}
                        className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-amber-50 hover:text-amber-600 dark:hover:bg-amber-900/20 dark:hover:text-amber-400"
                        title="รีเซ็ตรหัสผ่าน"
                      >
                        <KeyRound className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      onClick={() => toggleUserActive(u.id, u.active)}
                      className={cn(
                        'rounded-md p-1.5 transition-colors',
                        u.active
                          ? 'text-gray-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20'
                          : 'text-gray-400 hover:bg-emerald-50 hover:text-emerald-500 dark:hover:bg-emerald-900/20'
                      )}
                      title={u.active ? t('deactivate') : t('activate')}
                    >
                      {u.active ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
                    </button>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Create User Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => {
          setShowCreateModal(false);
          resetForm();
        }}
        title={t('addNewUser')}
        size="lg"
      >
        <div className="space-y-4">
          <Input
            label={t('username')}
            value={formUsername}
            onChange={(e) => setFormUsername(e.target.value)}
            placeholder={t('usernamePlaceholder')}
            hint={t('usernameHint')}
          />
          <Input
            label={t('password')}
            type="password"
            value={formPassword}
            onChange={(e) => setFormPassword(e.target.value)}
            placeholder={t('passwordPlaceholder')}
          />
          <Input
            label={t('displayName')}
            value={formDisplayName}
            onChange={(e) => setFormDisplayName(e.target.value)}
            placeholder={t('displayNamePlaceholder')}
          />
          <Select
            label={t('role')}
            value={formRole}
            onChange={(e) => setFormRole(e.target.value)}
            options={[
              { value: 'staff', label: t('roleStaff') },
              { value: 'bar', label: t('roleBar') },
              { value: 'technician', label: t('roleTechnician') },
              // Elevated roles are owner-only — HR cannot mint them.
              ...(isOwner
                ? [
                    { value: 'manager', label: t('roleManager') },
                    { value: 'accountant', label: t('roleAccountant') },
                    { value: 'hq', label: t('roleHQ') },
                    { value: 'hr', label: t('roleHR') },
                  ]
                : []),
            ]}
          />
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('branch')}
            </label>
            <div className="max-h-44 space-y-0.5 overflow-y-auto rounded-lg border border-gray-300 p-2 dark:border-gray-600">
              {stores.length === 0 ? (
                <p className="px-1 py-2 text-sm text-gray-400">ไม่มีสาขา</p>
              ) : (
                stores.map((s) => {
                  const checked = formStoreIds.includes(s.id);
                  return (
                    <label
                      key={s.id}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                        checked={checked}
                        onChange={(e) =>
                          setFormStoreIds((prev) =>
                            e.target.checked ? [...prev, s.id] : prev.filter((id) => id !== s.id),
                          )
                        }
                      />
                      <span className="text-gray-900 dark:text-white">{s.store_name}</span>
                    </label>
                  );
                })
              )}
            </div>
            <p className="mt-1 text-xs text-gray-400">เลือกได้มากกว่า 1 สาขา (เช่น ช่างที่ดูแลหลายสาขา)</p>
          </div>
        </div>
        <ModalFooter>
          <Button
            variant="outline"
            onClick={() => {
              setShowCreateModal(false);
              resetForm();
            }}
          >
            {t('cancel')}
          </Button>
          <Button
            onClick={handleCreateUser}
            isLoading={isSubmitting}
            disabled={!formUsername || !formPassword}
            icon={<Plus className="h-4 w-4" />}
          >
            {t('createUser')}
          </Button>
        </ModalFooter>
      </Modal>

      {/* Manage Branches Modal */}
      <Modal
        isOpen={!!storeEditUser}
        onClose={() => setStoreEditUser(null)}
        title="จัดการสาขา"
        description={
          storeEditUser
            ? `${storeEditUser.display_name || storeEditUser.username} — เลือกสาขาที่ดูแล (เลือกได้หลายสาขา)`
            : undefined
        }
      >
        <div className="max-h-72 space-y-0.5 overflow-y-auto rounded-lg border border-gray-300 p-2 dark:border-gray-600">
          {stores.length === 0 ? (
            <p className="px-1 py-2 text-sm text-gray-400">ไม่มีสาขา</p>
          ) : (
            stores.map((s) => {
              const checked = editStoreIds.includes(s.id);
              return (
                <label
                  key={s.id}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    checked={checked}
                    onChange={(e) =>
                      setEditStoreIds((prev) =>
                        e.target.checked ? [...prev, s.id] : prev.filter((id) => id !== s.id),
                      )
                    }
                  />
                  <span className="text-gray-900 dark:text-white">{s.store_name}</span>
                </label>
              );
            })
          )}
        </div>
        <ModalFooter>
          <Button variant="outline" onClick={() => setStoreEditUser(null)}>
            {t('cancel')}
          </Button>
          <Button onClick={handleSaveStores} isLoading={savingStores} icon={<Store className="h-4 w-4" />}>
            บันทึก
          </Button>
        </ModalFooter>
      </Modal>

      {/* Reset Password Modal */}
      <Modal
        isOpen={!!resetTarget}
        onClose={() => {
          setResetTarget(null);
          setResetResult(null);
        }}
        title={resetResult ? 'รหัสผ่านใหม่' : 'รีเซ็ตรหัสผ่าน'}
      >
        {!resetResult ? (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              ต้องการรีเซ็ตรหัสผ่านของ{' '}
              <span className="font-semibold text-gray-900 dark:text-white">
                {resetTarget?.display_name || resetTarget?.username}
              </span>
              {' '}ใช่ไหม?
            </p>
            <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
              รหัสผ่านจะถูกตั้งใหม่เป็น <code className="font-bold">123456</code> — แจ้งให้พนักงานเข้าสู่ระบบและเปลี่ยนรหัสด้วยตัวเองทันที
            </div>
            <ModalFooter>
              <Button
                variant="outline"
                onClick={() => setResetTarget(null)}
                disabled={isResetting}
              >
                ยกเลิก
              </Button>
              <Button
                onClick={handleResetPassword}
                isLoading={isResetting}
                icon={<KeyRound className="h-4 w-4" />}
              >
                ยืนยันรีเซ็ต
              </Button>
            </ModalFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400">
              ✓ รีเซ็ตรหัสผ่านของ <span className="font-semibold">{resetResult.username}</span> เรียบร้อยแล้ว
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">รหัสผ่านใหม่</p>
              <div className="mt-1 flex items-center gap-2">
                <code className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-base font-semibold text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-white">
                  {resetResult.password}
                </code>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(resetResult.password);
                    toast({ type: 'success', title: 'คัดลอกแล้ว' });
                  }}
                  className="rounded-lg border border-gray-200 p-2 text-gray-500 transition-colors hover:bg-indigo-50 hover:text-indigo-600 dark:border-gray-700 dark:hover:bg-indigo-900/30"
                  title="คัดลอกรหัส"
                >
                  <Copy className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                ⚠️ แจ้งพนักงานให้เปลี่ยนรหัสด้วยตัวเองทันทีหลังเข้าสู่ระบบ
              </p>
            </div>
            <ModalFooter>
              <Button
                onClick={() => {
                  setResetTarget(null);
                  setResetResult(null);
                }}
              >
                ปิด
              </Button>
            </ModalFooter>
          </div>
        )}
      </Modal>
    </div>
  );
}
