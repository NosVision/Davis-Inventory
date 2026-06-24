'use client';

import { useMemo, useState } from 'react';
import { Search, UserPlus, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import { Button, Input, Select, toast } from '@/components/ui';
import { MemberManagerModal } from './member-manager-modal';
import { initial, avatarColor } from '@/lib/tasks/format';
import { ROLE_LABELS, type UserRole } from '@/types/roles';
import { cn } from '@/lib/utils/cn';
import type { TaskRoomMember } from '@/types/tasks';

interface TabMembersProps {
  roomId: string;
  members: TaskRoomMember[];
  canManage: boolean;
  onChanged: () => void;
}

export function TabMembers({ roomId, members, canManage, onChanged }: TabMembersProps) {
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return members.filter((m) => {
      const name = `${m.profile?.display_name ?? ''} ${m.profile?.username ?? ''}`.toLowerCase();
      if (q && !name.includes(q)) return false;
      if (roleFilter === 'manager' && m.role !== 'manager') return false;
      if (roleFilter === 'member' && m.role !== 'member') return false;
      return true;
    });
  }, [members, search, roleFilter]);

  const setRole = async (m: TaskRoomMember, role: 'member' | 'manager') => {
    setBusyId(m.user_id);
    try {
      const res = await fetch(`/api/tasks/rooms/${roomId}/members`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: m.user_id, role }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'แก้บทบาทไม่สำเร็จ');
      onChanged();
    } catch (e) {
      toast({ type: 'error', title: 'ผิดพลาด', message: e instanceof Error ? e.message : '' });
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (m: TaskRoomMember) => {
    const name = m.profile?.display_name || m.profile?.username || 'สมาชิก';
    if (!confirm(`เอา "${name}" ออกจากห้อง?`)) return;
    setBusyId(m.user_id);
    try {
      const res = await fetch(`/api/tasks/rooms/${roomId}/members`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: m.user_id }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'เอาออกไม่สำเร็จ');
      onChanged();
    } catch (e) {
      toast({ type: 'error', title: 'ผิดพลาด', message: e instanceof Error ? e.message : '' });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาสมาชิก"
            leftIcon={<Search className="h-4 w-4" />}
          />
        </div>
        <div className="sm:w-44 sm:shrink-0">
          <Select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            options={[
              { value: 'all', label: 'ทุกบทบาท' },
              { value: 'manager', label: 'หัวหน้าห้อง' },
              { value: 'member', label: 'สมาชิก' },
            ]}
          />
        </div>
        {canManage && (
          <Button size="md" className="sm:shrink-0" icon={<UserPlus className="h-4 w-4" />} onClick={() => setShowAdd(true)}>
            ดึงสมาชิก
          </Button>
        )}
      </div>

      <p className="text-xs text-gray-400">แสดง {filtered.length} จาก {members.length} คน</p>

      {filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-400">ไม่พบสมาชิกตามเงื่อนไข</p>
      ) : (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
          {filtered.map((m) => {
            const name = m.profile?.display_name || m.profile?.username || 'ผู้ใช้';
            const busy = busyId === m.user_id;
            return (
              <li key={m.id} className="flex items-center gap-2 bg-white px-3 py-2.5 text-sm dark:bg-gray-800">
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
                  style={{ backgroundColor: avatarColor(m.user_id) }}
                >
                  {initial(name)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-gray-800 dark:text-gray-200">{name}</p>
                  <p className="text-xs text-gray-400">
                    {ROLE_LABELS[m.profile?.role as UserRole] ?? m.profile?.role ?? ''}
                    {m.role === 'manager' && ' · หัวหน้าห้อง'}
                  </p>
                </div>

                {canManage && (
                  <div className="flex items-center gap-1">
                    {m.role === 'manager' ? (
                      <button
                        disabled={busy}
                        onClick={() => setRole(m, 'member')}
                        title="ลดเป็นสมาชิก"
                        className="flex items-center gap-1 rounded-md bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 dark:bg-indigo-900/30 dark:text-indigo-400"
                      >
                        <ChevronDown className="h-3.5 w-3.5" /> หัวหน้า
                      </button>
                    ) : (
                      <button
                        disabled={busy}
                        onClick={() => setRole(m, 'manager')}
                        title="ตั้งเป็นหัวหน้าห้อง"
                        className="flex items-center gap-1 rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-200 disabled:opacity-50 dark:bg-gray-700 dark:text-gray-300"
                      >
                        <ChevronUp className="h-3.5 w-3.5" /> สมาชิก
                      </button>
                    )}
                    <button
                      disabled={busy}
                      onClick={() => remove(m)}
                      title="เอาออกจากห้อง"
                      className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-900/20"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {showAdd && (
        <MemberManagerModal
          roomId={roomId}
          existingIds={members.map((m) => m.user_id)}
          onClose={() => setShowAdd(false)}
          onUpdated={onChanged}
        />
      )}
    </div>
  );
}
