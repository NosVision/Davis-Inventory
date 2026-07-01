'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { ArrowLeft, Loader2, Users, ChevronDown, ChevronUp, Plus } from 'lucide-react';
import { Tabs, Button } from '@/components/ui';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/stores/auth-store';
import { RoomIcon } from '@/components/tasks/room-icon';
import { getRoomColor } from '@/lib/tasks/colors';
import { TabTasks } from '@/components/tasks/tab-tasks';
import { TaskFormModal } from '@/components/tasks/task-form-modal';
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
  const t = useTranslations('tasks');
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
  const [showCreate, setShowCreate] = useState(false);
  const [taskRefresh, setTaskRefresh] = useState(0);

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
        <p className="text-gray-500">{t('room.notFound')}</p>
        <Link href="/tasks" className="mt-3 inline-block text-sm text-indigo-600">{t('room.backToRooms')}</Link>
      </div>
    );
  }

  const canExport = isOwner || user?.role === 'manager' || user?.role === 'accountant';
  // ห้องแบบ claim/all = พนักงาน "แจ้งเรื่อง", ห้อง manual = เจ้าของ "เพิ่มงาน"
  const isReport = !!room.assign_mode && room.assign_mode !== 'manual';
  const tabs = [
    { id: 'overview', label: t('tabs.overview') },
    { id: 'tasks', label: t('tabs.tasks') },
    { id: 'recurring', label: t('tabs.recurring') },
    { id: 'history', label: t('tabs.history') },
    { id: 'stats', label: t('tabs.stats') },
    ...(isOwner ? [{ id: 'members', label: t('tabs.members'), count: members.length }] : []),
    ...(isOwner ? [{ id: 'settings', label: t('tabs.settings') }] : []),
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
        {/* ปุ่มสร้าง/แจ้งเรื่อง — อยู่บนหัวเพื่อกดได้จากทุกแท็บ */}
        {canCreate && (
          <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setShowCreate(true)} className="shrink-0">
            {isReport ? t('room.report') : t('room.addTask')}
          </Button>
        )}
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
                <Users className="h-4 w-4" /> {t('room.membersInRoom', { count: members.length })}
              </span>
              {membersOpen ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
            </button>
            {membersOpen && (
              <div className="flex max-h-60 flex-wrap gap-2 overflow-y-auto px-4 pb-4">
                {memberProfiles.map((m) => {
                  const name = m.display_name || m.username || t('detail.defaultUser');
                  return (
                    <span key={m.id} className="flex items-center gap-1.5 rounded-full bg-gray-100 py-1 pl-1 pr-3 text-xs dark:bg-gray-700">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold text-white" style={{ backgroundColor: avatarColor(m.id) }}>
                        {initial(name)}
                      </span>
                      {name}
                    </span>
                  );
                })}
                {members.length === 0 && <p className="text-xs text-gray-400">{t('room.noMembers')}</p>}
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
        <TabTasks roomId={roomId} currentUserId={user.id} refreshKey={taskRefresh} onTasksChanged={loadRoom} />
      )}

      {tab === 'recurring' && <TabRecurring roomId={roomId} members={memberProfiles} isOwner={isOwner} />}

      {tab === 'history' && user && <TabHistory roomId={roomId} currentUserId={user.id} />}

      {tab === 'stats' && <TabStats roomId={roomId} />}

      {tab === 'members' && isOwner && (
        <TabMembers roomId={roomId} members={members} canManage={isOwner} onChanged={loadRoom} />
      )}

      {showCreate && user && canCreate && (
        <TaskFormModal
          roomId={roomId}
          members={memberProfiles}
          stores={stores}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setTaskRefresh((k) => k + 1);
            loadRoom();
          }}
        />
      )}
    </div>
  );
}
