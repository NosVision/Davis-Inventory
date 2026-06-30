'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2, Users, ChevronDown, ChevronUp } from 'lucide-react';
import { Tabs } from '@/components/ui';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/stores/auth-store';
import { RoomIcon } from '@/components/tasks/room-icon';
import { getRoomColor } from '@/lib/tasks/colors';
import { TabTasks } from '@/components/tasks/tab-tasks';
import { TabOverview } from '@/components/tasks/tab-overview';
import { TabRecurring } from '@/components/tasks/tab-recurring';
import { TabHistory } from '@/components/tasks/tab-history';
import { TabStats } from '@/components/tasks/tab-stats';
import { RoomSettings } from '@/components/tasks/room-settings';
import { TabMembers } from '@/components/tasks/tab-members';
import { initial, avatarColor } from '@/lib/tasks/format';
import type { ProfileLite, TaskRoom, TaskRoomMember } from '@/types/tasks';

interface StoreOption {
  id: string;
  name: string;
}

export default function RoomPage() {
  const params = useParams<{ roomId: string }>();
  const roomId = params.roomId;
  const { user } = useAuthStore();

  const [room, setRoom] = useState<TaskRoom | null>(null);
  const [members, setMembers] = useState<TaskRoomMember[]>([]);
  const [isOwner, setIsOwner] = useState(false);
  const [canCreate, setCanCreate] = useState(false);
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('overview');
  const [membersOpen, setMembersOpen] = useState(false);

  const loadRoom = useCallback(async () => {
    const res = await fetch(`/api/tasks/rooms/${roomId}`);
    const data = await res.json();
    if (res.ok) {
      setRoom(data.room);
      setMembers(data.members ?? []);
      setIsOwner(!!data.isOwner);
      setCanCreate(!!data.canCreate);
    }
    setLoading(false);
  }, [roomId]);

  useEffect(() => {
    loadRoom();
    const supabase = createClient();
    supabase
      .from('stores')
      .select('id, store_name')
      .eq('active', true)
      .then(({ data }) => {
        setStores(((data as { id: string; store_name: string }[]) ?? []).map((s) => ({ id: s.id, name: s.store_name })));
      });
  }, [loadRoom]);

  const memberProfiles = useMemo<ProfileLite[]>(
    () => members.map((m) => m.profile).filter((p): p is ProfileLite => !!p),
    [members],
  );
  const c = getRoomColor(room?.color);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-7 w-7 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (!room) {
    return (
      <div className="mx-auto max-w-3xl p-6 text-center">
        <p className="text-gray-500">ไม่พบห้องงาน หรือคุณไม่มีสิทธิ์เข้าถึง</p>
        <Link href="/tasks" className="mt-3 inline-block text-sm text-indigo-600">← กลับไปหน้าห้องงาน</Link>
      </div>
    );
  }

  const canExport = isOwner || user?.role === 'manager' || user?.role === 'accountant';
  const tabs = [
    { id: 'overview', label: 'ภาพรวม' },
    { id: 'tasks', label: 'งาน' },
    { id: 'recurring', label: 'งานประจำ' },
    { id: 'history', label: 'ประวัติ' },
    { id: 'stats', label: 'สถิติ' },
    ...(isOwner ? [{ id: 'members', label: 'สมาชิก', count: members.length }] : []),
    ...(isOwner ? [{ id: 'settings', label: 'ตั้งค่า' }] : []),
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/tasks" className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <span className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ backgroundColor: c.tint, color: c.accent }}>
          <RoomIcon name={room.icon} className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold text-gray-900 dark:text-white">{room.name}</h1>
          {room.description && <p className="truncate text-xs text-gray-500">{room.description}</p>}
        </div>
      </div>

      <Tabs tabs={tabs} activeTab={tab} onChange={setTab} />

      {tab === 'overview' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-gray-200 dark:border-gray-700">
            <button
              onClick={() => setMembersOpen((o) => !o)}
              className="flex w-full items-center justify-between p-4 text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              <span className="flex items-center gap-2">
                <Users className="h-4 w-4" /> สมาชิกในห้อง ({members.length})
              </span>
              {membersOpen ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
            </button>
            {membersOpen && (
              <div className="flex max-h-60 flex-wrap gap-2 overflow-y-auto px-4 pb-4">
                {memberProfiles.map((m) => {
                  const name = m.display_name || m.username || 'ผู้ใช้';
                  return (
                    <span key={m.id} className="flex items-center gap-1.5 rounded-full bg-gray-100 py-1 pl-1 pr-3 text-xs dark:bg-gray-700">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold text-white" style={{ backgroundColor: avatarColor(m.id) }}>
                        {initial(name)}
                      </span>
                      {name}
                    </span>
                  );
                })}
                {members.length === 0 && <p className="text-xs text-gray-400">ยังไม่มีสมาชิก</p>}
              </div>
            )}
          </div>
          {user && (
            <TabOverview
              roomId={roomId}
              roomName={room.name}
              currentUserId={user.id}
              canExport={canExport}
              onChanged={loadRoom}
            />
          )}
        </div>
      )}

      {tab === 'settings' && isOwner && (
        <RoomSettings room={room} onUpdated={loadRoom} stores={stores} members={memberProfiles} />
      )}

      {tab === 'tasks' && user && (
        <TabTasks roomId={roomId} members={memberProfiles} stores={stores} currentUserId={user.id} canCreate={canCreate} onTasksChanged={loadRoom} />
      )}

      {tab === 'recurring' && <TabRecurring roomId={roomId} members={memberProfiles} isOwner={isOwner} />}

      {tab === 'history' && user && <TabHistory roomId={roomId} currentUserId={user.id} />}

      {tab === 'stats' && <TabStats roomId={roomId} />}

      {tab === 'members' && isOwner && (
        <TabMembers roomId={roomId} members={members} canManage={isOwner} onChanged={loadRoom} />
      )}
    </div>
  );
}
