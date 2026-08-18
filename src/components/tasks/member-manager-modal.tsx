'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Modal, ModalFooter, Button, Input, toast } from '@/components/ui';
import { Search, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { initial, avatarColor } from '@/lib/tasks/format';
import { type UserRole } from '@/types/roles';
import { cn } from '@/lib/utils/cn';

type Scope = 'people' | 'role' | 'branch' | 'everyone';

const SCOPE_ROLES: UserRole[] = ['manager', 'bar', 'head_bar', 'technician', 'staff', 'accountant'];

interface ProfileRow {
  id: string;
  display_name: string | null;
  username: string | null;
  role: string;
}
interface StoreRow {
  id: string;
  store_name: string;
}

interface MemberManagerModalProps {
  roomId: string;
  existingIds: string[];
  onClose: () => void;
  onUpdated: () => void;
}

export function MemberManagerModal({ roomId, existingIds, onClose, onUpdated }: MemberManagerModalProps) {
  const t = useTranslations('tasks');
  const tc = useTranslations('common');
  const tr = useTranslations('roles');
  const [scope, setScope] = useState<Scope>('people');
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  const [pickedUsers, setPickedUsers] = useState<string[]>([]);
  const [pickedRoles, setPickedRoles] = useState<string[]>([]);
  const [pickedStores, setPickedStores] = useState<string[]>([]);

  useEffect(() => {
    const supabase = createClient();
    Promise.all([
      supabase.from('profiles').select('id, display_name, username, role').eq('active', true).neq('role', 'customer'),
      supabase.from('stores').select('id, store_name').eq('active', true).eq('hr_only', false),
    ]).then(([p, s]) => {
      setProfiles((p.data as ProfileRow[]) ?? []);
      setStores((s.data as StoreRow[]) ?? []);
      setLoading(false);
    });
  }, []);

  const existing = useMemo(() => new Set(existingIds), [existingIds]);
  const filteredProfiles = useMemo(() => {
    const q = search.trim().toLowerCase();
    return profiles.filter((p) => {
      if (q && !`${p.display_name ?? ''} ${p.username ?? ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [profiles, search]);

  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  const submit = async () => {
    const payload: Record<string, unknown> = { scope };
    if (scope === 'people') {
      if (pickedUsers.length === 0) return toast({ type: 'error', title: t('members.selectStaffFirst') });
      payload.userIds = pickedUsers;
    } else if (scope === 'role') {
      if (pickedRoles.length === 0) return toast({ type: 'error', title: t('members.selectRoleFirst') });
      payload.roles = pickedRoles;
    } else if (scope === 'branch') {
      if (pickedStores.length === 0) return toast({ type: 'error', title: t('members.selectBranchFirst') });
      payload.storeIds = pickedStores;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/tasks/rooms/${roomId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('members.pullMembersFailed'));
      toast({ type: 'success', title: t('members.membersUpdated') });
      onUpdated();
      onClose();
    } catch (e) {
      toast({ type: 'error', title: tc('error'), message: e instanceof Error ? e.message : '' });
    } finally {
      setSaving(false);
    }
  };

  const scopeBtn = (s: Scope, label: string) => (
    <button
      type="button"
      onClick={() => setScope(s)}
      className={cn(
        'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
        scope === s ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
      )}
    >
      {label}
    </button>
  );

  return (
    <Modal isOpen onClose={onClose} title={t('members.managerModalTitle')} size="md">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {scopeBtn('people', t('members.scopePeople'))}
          {scopeBtn('role', t('members.scopeRole'))}
          {scopeBtn('branch', t('members.scopeBranch'))}
          {scopeBtn('everyone', t('members.scopeEveryone'))}
        </div>

        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-indigo-500" /></div>
        ) : scope === 'everyone' ? (
          <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-600 dark:bg-gray-800 dark:text-gray-300">
            {t('members.everyoneNotice')}
          </p>
        ) : scope === 'role' ? (
          <div className="grid grid-cols-2 gap-2">
            {SCOPE_ROLES.map((r) => (
              <label key={r} className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700">
                <input type="checkbox" checked={pickedRoles.includes(r)} onChange={() => setPickedRoles((s) => toggle(s, r))} className="h-4 w-4 rounded" />
                {tr(r)}
              </label>
            ))}
          </div>
        ) : scope === 'branch' ? (
          <div className="max-h-60 space-y-1.5 overflow-y-auto">
            {stores.map((s) => (
              <label key={s.id} className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700">
                <input type="checkbox" checked={pickedStores.includes(s.id)} onChange={() => setPickedStores((x) => toggle(x, s.id))} className="h-4 w-4 rounded" />
                {s.store_name}
              </label>
            ))}
          </div>
        ) : (
          <>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('members.searchStaff')} leftIcon={<Search className="h-4 w-4" />} />
            <div className="max-h-60 space-y-1 overflow-y-auto">
              {filteredProfiles.map((p) => {
                const name = p.display_name || p.username || t('members.defaultUser');
                const already = existing.has(p.id);
                const on = pickedUsers.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={already}
                    onClick={() => setPickedUsers((s) => toggle(s, p.id))}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm',
                      already ? 'opacity-40' : on ? 'bg-indigo-50 dark:bg-indigo-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-800',
                    )}
                  >
                    <span className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold text-white" style={{ backgroundColor: avatarColor(p.id) }}>
                      {initial(name)}
                    </span>
                    <span className="flex-1 truncate text-gray-700 dark:text-gray-200">{name}</span>
                    <span className="text-xs text-gray-400">{already ? t('members.alreadyIn') : tr(p.role as Parameters<typeof tr>[0])}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>{tc('cancel')}</Button>
        <Button onClick={submit} isLoading={saving} disabled={loading}>{t('members.addMembers')}</Button>
      </ModalFooter>
    </Modal>
  );
}
