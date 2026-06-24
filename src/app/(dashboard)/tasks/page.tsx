'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Loader2, ClipboardList, CalendarDays } from 'lucide-react';
import { Button, Select } from '@/components/ui';
import { useAuthStore } from '@/stores/auth-store';
import { RoomCard } from '@/components/tasks/room-card';
import { RoomFormModal } from '@/components/tasks/room-form-modal';
import type { TaskRoomWithStats } from '@/types/tasks';

export default function TasksPage() {
  const { user } = useAuthStore();
  const isOwner = user?.role === 'owner';

  const [rooms, setRooms] = useState<TaskRoomWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [branchFilter, setBranchFilter] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/tasks/rooms');
      const data = await res.json();
      if (res.ok) setRooms(data.rooms ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // รายชื่อสาขาที่มีงานอยู่ (สำหรับตัวกรอง) — ไม่รวม "ทุกสาขา"
  const branchOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rooms) for (const b of r.branches) if (b && b !== 'ทุกสาขา') set.add(b);
    return [...set].sort();
  }, [rooms]);

  // ห้องที่เกี่ยวข้องกับสาขาที่เลือก (ห้องที่มีงานข้ามสาขา "ทุกสาขา" ก็แสดงเสมอ)
  const filteredRooms = useMemo(() => {
    const base =
      branchFilter === 'all'
        ? rooms
        : rooms.filter((r) => r.branches.includes(branchFilter) || r.has_all_branch);
    // ห้องที่ติดดาว (ใช้บ่อย) ขึ้นก่อน
    return [...base].sort((a, b) => Number(b.is_favorite) - Number(a.is_favorite));
  }, [rooms, branchFilter]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">ห้องงาน</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">จัดการงานแยกตามสายงาน</p>
        </div>
        <div className="flex items-center gap-2">
          {!isOwner && (
            <Link href="/tasks/calendar">
              <Button variant="outline" icon={<CalendarDays className="h-4 w-4" />}>
                ปฏิทินของฉัน
              </Button>
            </Link>
          )}
          {isOwner && (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setShowCreate(true)}>
              สร้างห้อง
            </Button>
          )}
        </div>
      </div>

      {branchOptions.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-sm text-gray-500 dark:text-gray-400">กรองตามสาขา</span>
          <div className="w-full sm:w-64">
            <Select
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              options={[
                { value: 'all', label: 'ทุกสาขา' },
                ...branchOptions.map((b) => ({ value: b, label: b })),
              ]}
            />
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-7 w-7 animate-spin text-indigo-500" />
        </div>
      ) : filteredRooms.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <ClipboardList className="h-10 w-10 text-gray-300" />
          <p className="text-sm text-gray-400">
            {rooms.length === 0 ? 'ยังไม่มีห้องงานที่คุณเป็นสมาชิก' : 'ไม่มีห้องงานในสาขานี้'}
          </p>
          {isOwner && rooms.length === 0 && (
            <Button variant="outline" size="sm" onClick={() => setShowCreate(true)}>
              สร้างห้องแรก
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredRooms.map((r) => (
            <RoomCard key={r.id} room={r} onChanged={load} />
          ))}
        </div>
      )}

      {showCreate && <RoomFormModal onClose={() => setShowCreate(false)} onCreated={load} />}
    </div>
  );
}
